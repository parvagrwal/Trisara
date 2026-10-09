// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./GuardedSwapRouter.sol"; // FeedReader, IERC20T

interface IAnchorClock {
    function isOpen(uint8 anchor, uint256 timestamp) external pure returns (bool);
}

/// @title GuardedLender
/// @notice Minimal isolated lending market with session-aware risk.
///   - Collateral valued at the guarded venue price; max LTV 50% while the
///     anchor is OPEN, 35% while CLOSED (session read from AnchorClock).
///   - Liquidations trigger ONLY on the refFeed adapter price (INV-7: a
///     manipulated venue TWAP/markPx can restrict borrowing but never makes
///     a healthy account liquidatable), only while OPEN, and only after the
///     reopening grace window.
///   - INV-5: repay() and withdrawCollateral() (when debt is zero) never revert.
contract GuardedLender {
    IERC20T public immutable collateralToken;
    IERC20T public immutable debtToken;
    IAnchorClock public immutable clock;
    uint8 public immutable anchor; // AnchorClock.Anchor as uint8
    address public immutable venueFeed; // guarded venue price (collateral valuation)
    address public immutable referenceFeed; // refFeed adapter (liquidation trigger ONLY)

    uint256 public constant OPEN_LTV_BPS = 5_000; // 50%
    uint256 public constant CLOSED_LTV_BPS = 3_500; // 35%
    uint256 public immutable graceWindow; // e.g. 15 min after reopen
    uint256 public immutable maxTotalDebt; // 0 = uncapped (testnet); cap on mainnet fallback

    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;
    uint256 public totalDebt;

    // Session tracking (permissionless poke; state derives from the clock).
    uint256 public closedSince; // 0 = not closed
    uint256 public reopenedAt; // 0 = never reopened since close

    event Deposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount, uint256 ltvBps);
    event Repaid(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtCovered, uint256 collSeized);

    constructor(
        address _collateralToken,
        address _debtToken,
        address _clock,
        uint8 _anchor,
        address _venueFeed,
        address _referenceFeed,
        uint256 _graceWindow,
        uint256 _maxTotalDebt
    ) {
        require(_collateralToken != address(0) && _debtToken != address(0), "zero token");
        require(_clock != address(0) && _venueFeed != address(0) && _referenceFeed != address(0), "zero address");
        collateralToken = IERC20T(_collateralToken);
        debtToken = IERC20T(_debtToken);
        clock = IAnchorClock(_clock);
        anchor = _anchor;
        venueFeed = _venueFeed;
        referenceFeed = _referenceFeed;
        graceWindow = _graceWindow;
        maxTotalDebt = _maxTotalDebt;
    }

    /// @notice Advance the session tracker. Anyone can call; state comes from the clock.
    function pokeSession() public {
        bool open = clock.isOpen(anchor, block.timestamp);
        if (!open && closedSince == 0) closedSince = block.timestamp;
        if (open && closedSince != 0) {
            reopenedAt = block.timestamp;
            closedSince = 0;
        }
    }

    function _maxLtvBps() internal view returns (uint256) {
        return clock.isOpen(anchor, block.timestamp) ? OPEN_LTV_BPS : CLOSED_LTV_BPS;
    }

    /// @notice Collateral value in debt-token WAD (both 18-dec normalized here;
    /// pass 18-decimal tokens or scale at integration).
    function _collateralValue(address user) internal view returns (uint256 valueWad, bool ok) {
        (uint256 price,, bool feedOk) = FeedReader.readFeed(venueFeed);
        if (!feedOk || price == 0) return (0, false);
        return ((collateral[user] * price) / 1e18, true);
    }

    function depositCollateral(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "deposit failed");
        collateral[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Borrow against collateral at the session LTV.
    function borrow(uint256 amount) external {
        require(amount > 0, "zero amount");
        if (maxTotalDebt != 0) require(totalDebt + amount <= maxTotalDebt, "debt cap");
        (uint256 valueWad, bool ok) = _collateralValue(msg.sender);
        require(ok, "no price");
        uint256 maxBorrow = (valueWad * _maxLtvBps()) / 10_000;
        require(debt[msg.sender] + amount <= maxBorrow, "exceeds LTV");
        debt[msg.sender] += amount;
        totalDebt += amount;
        require(debtToken.transfer(msg.sender, amount), "payout failed");
        emit Borrowed(msg.sender, amount, _maxLtvBps());
    }

    /// @notice INV-5: repay is never blocked, in any state.
    function repay(uint256 amount) external {
        require(amount > 0, "zero amount");
        uint256 owed = debt[msg.sender];
        require(owed > 0, "no debt");
        uint256 pay = amount > owed ? owed : amount;
        require(debtToken.transferFrom(msg.sender, address(this), pay), "repay failed");
        debt[msg.sender] = owed - pay;
        totalDebt -= pay;
        emit Repaid(msg.sender, pay);
    }

    /// @notice INV-5: withdrawing with zero debt never reverts. Otherwise the
    /// remaining position must stay within the session LTV.
    function withdrawCollateral(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(collateral[msg.sender] >= amount, "insufficient");
        if (debt[msg.sender] > 0) {
            (uint256 valueWad, bool ok) = _collateralValue(msg.sender);
            require(ok, "no price");
            (uint256 price,,) = FeedReader.readFeed(venueFeed);
            uint256 newValue = valueWad - ((amount * price) / 1e18);
            require(debt[msg.sender] * 10_000 <= newValue * _maxLtvBps(), "would breach LTV");
        }
        collateral[msg.sender] -= amount;
        require(collateralToken.transfer(msg.sender, amount), "withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Liquidate an undercollateralized account. Trigger price comes
    /// ONLY from the refFeed adapter (INV-7); only while the anchor is OPEN
    /// and past the reopening grace window.
    function liquidate(address user) external {
        require(clock.isOpen(anchor, block.timestamp), "not open");
        require(reopenedAt == 0 || block.timestamp >= reopenedAt + graceWindow, "in grace");
        (uint256 refPrice,, bool ok) = FeedReader.readFeed(referenceFeed);
        require(ok && refPrice > 0, "no refFeed price");
        uint256 valueWad = (collateral[user] * refPrice) / 1e18;
        require(debt[user] > 0, "no debt");
        // Undercollateralized against the CURRENT (open-session) LTV on refFeed price.
        require(debt[user] * 10_000 > valueWad * OPEN_LTV_BPS, "healthy on refFeed");
        uint256 debtCovered = debt[user];
        uint256 collSeized = collateral[user];
        debt[user] = 0;
        collateral[user] = 0;
        totalDebt -= debtCovered;
        require(debtToken.transferFrom(msg.sender, address(this), debtCovered), "cover failed");
        require(collateralToken.transfer(msg.sender, collSeized), "seize failed");
        emit Liquidated(user, msg.sender, debtCovered, collSeized);
    }
}

/// @title UnguardedLender
/// @notice The unprotected twin: fixed 60% LTV, liquidates on the VENUE price
/// immediately, no grace, no session awareness. Exists for the A/B demo —
/// this is the lender that liquidates on the squeezed print.
contract UnguardedLender {
    IERC20T public immutable collateralToken;
    IERC20T public immutable debtToken;
    address public immutable venueFeed;

    uint256 public constant LTV_BPS = 6_000; // 60%, always

    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    event Liquidated(address indexed user, uint256 debtCovered, uint256 collSeized);

    constructor(address _collateralToken, address _debtToken, address _venueFeed) {
        collateralToken = IERC20T(_collateralToken);
        debtToken = IERC20T(_debtToken);
        venueFeed = _venueFeed;
    }

    function depositCollateral(uint256 amount) external {
        require(collateralToken.transferFrom(msg.sender, address(this), amount), "deposit failed");
        collateral[msg.sender] += amount;
    }

    function borrow(uint256 amount) external {
        (uint256 price,, bool ok) = FeedReader.readFeed(venueFeed);
        require(ok, "no price");
        uint256 maxBorrow = (collateral[msg.sender] * price * LTV_BPS) / (1e18 * 10_000);
        require(debt[msg.sender] + amount <= maxBorrow, "exceeds LTV");
        debt[msg.sender] += amount;
        require(debtToken.transfer(msg.sender, amount), "payout failed");
    }

    function repay(uint256 amount) external {
        uint256 owed = debt[msg.sender];
        uint256 pay = amount > owed ? owed : amount;
        require(debtToken.transferFrom(msg.sender, address(this), pay), "repay failed");
        debt[msg.sender] = owed - pay;
    }

    /// @notice Liquidates on the venue print immediately. No grace, no refFeed check.
    function liquidate(address user) external {
        (uint256 price,, bool ok) = FeedReader.readFeed(venueFeed);
        require(ok, "no price");
        uint256 valueWad = (collateral[user] * price) / 1e18;
        require(debt[user] * 10_000 > valueWad * LTV_BPS, "healthy");
        uint256 debtCovered = debt[user];
        uint256 collSeized = collateral[user];
        debt[user] = 0;
        collateral[user] = 0;
        require(debtToken.transferFrom(msg.sender, address(this), debtCovered), "cover failed");
        require(collateralToken.transfer(msg.sender, collSeized), "seize failed");
        emit Liquidated(user, debtCovered, collSeized);
    }
}
