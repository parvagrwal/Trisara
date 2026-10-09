// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./GuardedSwapRouter.sol"; // FeedReader, IERC20T
import "./GuardedLender.sol"; // IAnchorClock
import "../ReentrancyGuard.sol";

interface ITip403Pol {
    function isAuthorized(address account) external view returns (bool);
}

/// @title GuardedSettlementRouter (Tempo)
/// @notice Stablecoin settlement with session-aware safety.
///   - Accepts >=2 configured stablecoins (e.g. pathUSD, USDT0, USDC.e).
///   - At-par acceptance HALTS when the peg adapter reports a break beyond
///     pegToleranceBps while the Fed bank anchor is CLOSED (no bank rails to
///     arb the peg back).
///   - TIP-403-blocked payees route to refundable COMPLIANCE_HOLD escrow with
///     a reason code — zero stuck funds; claimRefund() anytime (INV-5).
contract GuardedSettlementRouter is ReentrancyGuard {
    mapping(address => bool) public accepted;
    address public immutable pegAdapter; // TempoStableAdapter for the settlement token
    IAnchorClock public immutable clock;
    uint8 public immutable fedAnchor; // AnchorClock.Anchor as uint8 (Fed)
    ITip403Pol public immutable policy;
    uint256 public immutable pegToleranceBps; // 30 = 0.30%
    address public immutable keeper;

    struct Hold {
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 reason;
        bool released;
        bool refunded;
    }
    mapping(uint256 => Hold) public holds;
    uint256 public nextHoldId;

    event Settled(
        bytes32 indexed invoiceId, address indexed payer, address indexed payee, address token, uint256 amount
    );
    event ComplianceHold(uint256 indexed id, address indexed payer, address indexed payee, bytes32 reason);
    event HoldReleased(uint256 indexed id, address indexed payee, uint256 amount);
    event HoldRefunded(uint256 indexed id, address indexed payer, uint256 amount);
    event PegHalt(address indexed token);

    constructor(
        address[] memory _tokens,
        address _pegAdapter,
        address _clock,
        uint8 _fedAnchor,
        address _policy,
        uint256 _pegToleranceBps,
        address _keeper
    ) {
        require(_tokens.length >= 2, "need >=2 stables");
        require(_pegAdapter != address(0) && _clock != address(0) && _keeper != address(0), "zero address");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "zero token");
            accepted[_tokens[i]] = true;
        }
        pegAdapter = _pegAdapter;
        clock = IAnchorClock(_clock);
        fedAnchor = _fedAnchor;
        policy = ITip403Pol(_policy);
        pegToleranceBps = _pegToleranceBps;
        keeper = _keeper;
    }

    /// @notice Settle `amount` of `token` to `payee` against `invoiceId`.
    function settle(address token, address payee, uint256 amount, bytes32 invoiceId) external nonReentrant {
        require(accepted[token], "token not accepted");
        require(payee != address(0) && amount > 0, "bad params");
        require(IERC20T(token).transferFrom(msg.sender, address(this), amount), "pull failed");

        // 1. Compliance: TIP-403-blocked payee -> refundable hold, never stuck.
        if (!_compliant(msg.sender, payee)) {
            uint256 id = ++nextHoldId;
            holds[id] = Hold({
                payer: msg.sender,
                payee: payee,
                token: token,
                amount: amount,
                reason: bytes32("COMPLIANCE_HOLD"),
                released: false,
                refunded: false
            });
            emit ComplianceHold(id, msg.sender, payee, bytes32("COMPLIANCE_HOLD"));
            return;
        }

        // 2. Peg: while the Fed anchor is CLOSED, a broken peg halts at-par acceptance.
        //    Broken = adapter reports !ok, OR price deviates beyond pegToleranceBps
        //    from $1.00 (the tolerance is enforced here, not just stored).
        if (!clock.isOpen(fedAnchor, block.timestamp)) {
            (uint256 pegPrice,, bool pegOk) = FeedReader.readFeed(pegAdapter);
            bool broken = !pegOk;
            if (pegOk && pegPrice > 0) {
                uint256 dev = pegPrice > 1e18 ? pegPrice - 1e18 : 1e18 - pegPrice;
                broken = dev * 10_000 > pegToleranceBps * 1e18;
            }
            if (broken) {
                uint256 id = ++nextHoldId;
                holds[id] = Hold({
                    payer: msg.sender,
                    payee: payee,
                    token: token,
                    amount: amount,
                    reason: bytes32("PEG_BREAK_CLOSED"),
                    released: false,
                    refunded: false
                });
                emit PegHalt(token);
                emit ComplianceHold(id, msg.sender, payee, bytes32("PEG_BREAK_CLOSED"));
                return;
            }
        }

        require(IERC20T(token).transfer(payee, amount), "payout failed");
        emit Settled(invoiceId, msg.sender, payee, token, amount);
    }

    /// @notice Keeper releases a hold once compliance/peg clears.
    function releaseHold(uint256 id) external nonReentrant {
        require(msg.sender == keeper, "not keeper");
        Hold storage h = holds[id];
        require(!h.released && !h.refunded, "closed");
        h.released = true;
        require(IERC20T(h.token).transfer(h.payee, h.amount), "payout failed");
        emit HoldReleased(id, h.payee, h.amount);
    }

    /// @notice INV-5: refunds are never blocked, in any state.
    function claimRefund(uint256 id) external nonReentrant {
        Hold storage h = holds[id];
        require(h.payer == msg.sender, "not payer");
        require(!h.released && !h.refunded, "closed");
        h.refunded = true;
        require(IERC20T(h.token).transfer(h.payer, h.amount), "refund failed");
        emit HoldRefunded(id, h.payer, h.amount);
    }

    function _compliant(address payer, address payee) internal view returns (bool) {
        if (address(policy) == address(0)) return false;
        (bool ok1, bytes memory r1) =
            address(policy).staticcall(abi.encodeWithSelector(ITip403Pol.isAuthorized.selector, payer));
        (bool ok2, bytes memory r2) =
            address(policy).staticcall(abi.encodeWithSelector(ITip403Pol.isAuthorized.selector, payee));
        if (!ok1 || r1.length < 32 || !ok2 || r2.length < 32) return false;
        return abi.decode(r1, (bool)) && abi.decode(r2, (bool));
    }
}

/// @title UnguardedSettlementRouter
/// @notice The unprotected twin: pays at par no matter what. No peg check,
/// no compliance check. Exists for the A/B demo.
contract UnguardedSettlementRouter {
    event Settled(
        bytes32 indexed invoiceId, address indexed payer, address indexed payee, address token, uint256 amount
    );

    function settle(address token, address payee, uint256 amount, bytes32 invoiceId) external {
        require(IERC20T(token).transferFrom(msg.sender, address(this), amount), "pull failed");
        require(IERC20T(token).transfer(payee, amount), "payout failed");
        emit Settled(invoiceId, msg.sender, payee, token, amount);
    }
}

/// @title ProtectionBilling (Tempo)
/// @notice Standalone protection-fee billing: venues pay TIP-20 stablecoin
/// fees with an invoice memo. The native transferWithMemo selector is
/// unconfirmed (S7 fallback), so settlement is a standard ERC-20 transfer and
/// the memo lives in the FeeReceipt event. Treasury is set at construction.
contract ProtectionBilling is ReentrancyGuard {
    IERC20T public immutable feeToken;
    address public immutable treasury;
    address public immutable admin;

    event FeeReceipt(bytes32 indexed invoiceId, address indexed payer, uint256 amount, bytes memo);

    constructor(address _feeToken, address _treasury, address _admin) {
        require(_feeToken != address(0) && _treasury != address(0) && _admin != address(0), "zero address");
        feeToken = IERC20T(_feeToken);
        treasury = _treasury;
        admin = _admin;
    }

    /// @notice Pay a protection fee. Memo is arbitrary bytes (invoice reference).
    function payFee(bytes32 invoiceId, uint256 amount, bytes calldata memo) external nonReentrant {
        require(amount > 0, "zero amount");
        require(feeToken.transferFrom(msg.sender, treasury, amount), "fee transfer failed");
        emit FeeReceipt(invoiceId, msg.sender, amount, memo);
    }
}
