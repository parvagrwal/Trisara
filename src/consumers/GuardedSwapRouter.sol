// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../ReentrancyGuard.sol";

/// @notice Shared helpers for consumers: decode any adapter's `read()`
/// (Reading struct ABI-encodes as a tuple) without importing Day-3 code.
library FeedReader {
    bytes4 internal constant READ_SEL = bytes4(keccak256("read()"));

    /// @notice Returns (priceWad, observedAt, ok). Never reverts on bad data.
    function readFeed(address feed) internal view returns (uint256 price, uint256 observedAt, bool ok) {
        (bool success, bytes memory ret) = feed.staticcall(abi.encodeWithSelector(READ_SEL));
        if (!success || ret.length < 96) return (0, 0, false);
        (price, observedAt, ok) = abi.decode(ret, (uint256, uint256, bool));
    }
}

interface IERC20T {
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IAggV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title GuardedSwapRouter (Robinhood Chain)
/// @notice Session-aware swap: tokenIn -> tokenOut at the guarded feed price,
/// enforced inside ±collarBps of the keeper-set reference price (Friday close).
///   - Feed HALT (revert/empty) -> instant refund, no escrow.
///   - Price outside collar -> DEFER escrow: claimRefund() anytime (INV-5),
///     executeDeferred() once the price is back inside the band.
///   - Uniswap-style "swap at any price" is the UnguardedSwapRouter twin.
contract GuardedSwapRouter is ReentrancyGuard {
    using FeedReader for address;

    IAggV3 public immutable guardedFeed;
    IERC20T public immutable tokenIn;
    IERC20T public immutable tokenOut;
    uint256 public immutable collarBps;
    address public immutable keeper;
    uint8 public immutable inDec;
    uint8 public immutable outDec;
    uint8 public immutable feedDec;

    uint256 public referencePrice; // keeper-set, feed decimals
    uint256 public nextId;

    struct Deferred {
        address user;
        uint256 amountIn;
        bool executed;
        bool refunded;
    }
    mapping(uint256 => Deferred) public deferred;

    event Swapped(address indexed user, uint256 amountIn, uint256 amountOut, uint256 price);
    event DeferredSwap(uint256 indexed id, address indexed user, uint256 amountIn, uint256 price);
    event DeferredExecuted(uint256 indexed id, uint256 amountOut, uint256 price);
    event Refunded(uint256 indexed id, address indexed user, uint256 amountIn);
    event ReferencePriceSet(uint256 price);

    constructor(
        address _guardedFeed,
        address _tokenIn,
        address _tokenOut,
        uint256 _collarBps,
        address _keeper,
        uint256 _referencePrice
    ) {
        require(_guardedFeed != address(0) && _tokenIn != address(0) && _tokenOut != address(0), "zero address");
        require(_keeper != address(0), "zero keeper");
        require(_collarBps <= 10_000, "bad collar");
        require(_referencePrice > 0, "bad ref price");
        guardedFeed = IAggV3(_guardedFeed);
        tokenIn = IERC20T(_tokenIn);
        tokenOut = IERC20T(_tokenOut);
        collarBps = _collarBps;
        keeper = _keeper;
        inDec = tokenIn.decimals();
        outDec = tokenOut.decimals();
        feedDec = guardedFeed.decimals();
        referencePrice = _referencePrice;
    }

    /// @notice Keeper funds tokenOut inventory for swaps.
    function fund(uint256 amount) external {
        require(msg.sender == keeper, "not keeper");
        require(tokenOut.transferFrom(msg.sender, address(this), amount), "fund failed");
    }

    /// @notice Keeper updates the reference (Friday close) price.
    function setReferencePrice(uint256 p) external {
        require(msg.sender == keeper, "not keeper");
        require(p > 0, "bad price");
        referencePrice = p;
        emit ReferencePriceSet(p);
    }

    /// @notice Swap tokenIn for tokenOut at the guarded price.
    /// Returns (id, amountOut): id != 0 means DEFERRED (escrowed).
    function swap(uint256 amountIn) external nonReentrant returns (uint256 id, uint256 amountOut) {
        require(amountIn > 0, "zero amount");
        require(tokenIn.transferFrom(msg.sender, address(this), amountIn), "pull failed");

        (bool ok, bytes memory ret) =
            address(guardedFeed).staticcall(abi.encodeWithSelector(IAggV3.latestRoundData.selector));
        if (!ok || ret.length < 160) {
            // Feed halted: instant refund, nothing escrowed.
            require(tokenIn.transfer(msg.sender, amountIn), "refund failed");
            emit Refunded(0, msg.sender, amountIn);
            return (0, 0);
        }
        (, int256 ans,,,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (ans <= 0) {
            require(tokenIn.transfer(msg.sender, amountIn), "refund failed");
            emit Refunded(0, msg.sender, amountIn);
            return (0, 0);
        }
        uint256 price = uint256(ans);
        if (!_insideCollar(price)) {
            id = ++nextId;
            deferred[id] = Deferred({user: msg.sender, amountIn: amountIn, executed: false, refunded: false});
            emit DeferredSwap(id, msg.sender, amountIn, price);
            return (id, 0);
        }
        amountOut = _quote(amountIn, price);
        require(tokenOut.transfer(msg.sender, amountOut), "payout failed");
        emit Swapped(msg.sender, amountIn, amountOut, price);
        return (0, amountOut);
    }

    /// @notice Execute a deferred swap at the current guarded price.
    /// Reverts if still outside the collar; use claimRefund instead.
    function executeDeferred(uint256 id) external nonReentrant {
        Deferred storage d = deferred[id];
        require(d.user == msg.sender, "not owner");
        require(!d.executed && !d.refunded, "closed");
        uint256 price = _guardedPrice();
        require(_insideCollar(price), "still outside collar");
        d.executed = true;
        uint256 amountOut = _quote(d.amountIn, price);
        require(tokenOut.transfer(msg.sender, amountOut), "payout failed");
        emit DeferredExecuted(id, amountOut, price);
    }

    /// @notice INV-5: refunds are never blocked, in any state.
    function claimRefund(uint256 id) external nonReentrant {
        Deferred storage d = deferred[id];
        require(d.user == msg.sender, "not owner");
        require(!d.executed && !d.refunded, "closed");
        d.refunded = true;
        require(tokenIn.transfer(msg.sender, d.amountIn), "refund failed");
        emit Refunded(id, msg.sender, d.amountIn);
    }

    // --- internals ---

    function _guardedPrice() internal view returns (uint256) {
        (bool ok, bytes memory ret) =
            address(guardedFeed).staticcall(abi.encodeWithSelector(IAggV3.latestRoundData.selector));
        require(ok && ret.length >= 160, "feed halted");
        (, int256 ans,,,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        require(ans > 0, "bad price");
        return uint256(ans);
    }

    function _insideCollar(uint256 price) internal view returns (bool) {
        uint256 ref = referencePrice;
        uint256 lo = (ref * (10_000 - collarBps)) / 10_000;
        uint256 hi = (ref * (10_000 + collarBps)) / 10_000;
        return price >= lo && price <= hi;
    }

    /// @notice amountOut = amountIn * price, decimal-adjusted. price is
    /// tokenOut per tokenIn in feedDec.
    function _quote(uint256 amountIn, uint256 price) internal view returns (uint256) {
        return (amountIn * price * (10 ** outDec)) / ((10 ** feedDec) * (10 ** inDec));
    }
}

/// @title UnguardedSwapRouter
/// @notice The unprotected twin: swaps at whatever the raw feed prints, no
/// collar, no refund path. Exists for the A/B demo (guarded vs unguarded).
contract UnguardedSwapRouter is ReentrancyGuard {
    IAggV3 public immutable rawFeed;
    IERC20T public immutable tokenIn;
    IERC20T public immutable tokenOut;
    uint8 public immutable inDec;
    uint8 public immutable outDec;
    uint8 public immutable feedDec;

    event Swapped(address indexed user, uint256 amountIn, uint256 amountOut, uint256 price);

    constructor(address _rawFeed, address _tokenIn, address _tokenOut) {
        require(_rawFeed != address(0) && _tokenIn != address(0) && _tokenOut != address(0), "zero address");
        rawFeed = IAggV3(_rawFeed);
        tokenIn = IERC20T(_tokenIn);
        tokenOut = IERC20T(_tokenOut);
        inDec = tokenIn.decimals();
        outDec = tokenOut.decimals();
        feedDec = rawFeed.decimals();
    }

    function fund(uint256 amount) external {
        require(tokenOut.transferFrom(msg.sender, address(this), amount), "fund failed");
    }

    /// @notice Swap at the raw print. No collar, no refund, no questions.
    function swap(uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "zero amount");
        require(tokenIn.transferFrom(msg.sender, address(this), amountIn), "pull failed");
        (, int256 ans,,,) = rawFeed.latestRoundData();
        require(ans > 0, "bad price");
        amountOut = (amountIn * uint256(ans) * (10 ** outDec)) / ((10 ** feedDec) * (10 ** inDec));
        require(amountOut >= minOut, "slippage");
        require(tokenOut.transfer(msg.sender, amountOut), "payout failed");
        emit Swapped(msg.sender, amountIn, amountOut, uint256(ans));
    }
}
