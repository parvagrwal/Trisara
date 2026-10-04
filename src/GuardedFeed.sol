// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/PriceIntegrity.sol";

/// @notice Minimal Chainlink AggregatorV3 interface (enough for a drop-in).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title GuardedFeed
/// @notice A one-address Chainlink AggregatorV3 drop-in that never hands out a
/// price it cannot vouch for. Behavior follows the venue's session clock and
/// price integrity, evaluated on the keeper's latest observation:
///   OPEN        -> pass the underlying feed through untouched.
///   DISLOCATED  -> COLLAR: clamp the print to last-open ± collarBps.
///   CLOSED / REOPENING -> DEFER: return the last open print (the honest close).
///   STALE / HALTED / CHAIN_DEGRADED -> HALT: revert; no price is safe to give.
/// @dev latestRoundData() is a pure view (the Chainlink interface is unbroken):
/// the keeper's poke() maintains the last-open print, so no state is written on read.
/// The keeper is trusted for *observation*, never for *judgment*: poke() re-runs
/// PriceIntegrity.evaluate and only records the print when the state is OPEN.
contract GuardedFeed is IAggregatorV3 {
    struct Observation {
        uint256 refPrice; // off-chain reference (e.g. Robinhood API), feed decimals
        uint256 observedAt; // when the keeper saw it
        uint8 marketStatus; // Chainlink marketStatus code
        bool haltFlag; // venue halted the asset
        bool chainDegraded; // venue feed pipeline degraded
        uint256 prevRefPrice; // previous reference print (velocity check)
        uint256 prevObservedAt;
    }

    IAggregatorV3 public immutable underlying;
    PriceIntegrity public immutable integrity;
    address public immutable keeper;
    /// @notice Clamp band for DISLOCATED prints, in bps (e.g. 100 = ±1%).
    uint256 public immutable collarBps;

    Observation public obs;
    bool public hasObservation;

    // Last print observed while the venue was OPEN (the honest close).
    uint80 public lastOpenRoundId;
    uint256 public lastOpenPrice;
    uint256 public lastOpenStartedAt;
    uint256 public lastOpenUpdatedAt;
    bool public hasOpenPrint;

    event Poked(PriceIntegrity.State state, uint256 refPrice, uint256 observedAt);

    constructor(address _underlying, address _integrity, address _keeper, uint256 _collarBps) {
        require(_underlying != address(0) && _integrity != address(0) && _keeper != address(0), "zero address");
        require(_collarBps <= 10_000, "bad collarBps");
        underlying = IAggregatorV3(_underlying);
        integrity = PriceIntegrity(_integrity);
        keeper = _keeper;
        collarBps = _collarBps;
    }

    /// @notice Keeper pushes the latest off-chain market snapshot. The contract
    /// derives the integrity state itself; the open print is only recorded on OPEN.
    function poke(Observation calldata o) external {
        require(msg.sender == keeper, "not keeper");
        obs = o;
        hasObservation = true;

        (uint80 rid, int256 ans, uint256 st_, uint256 upd,) = underlying.latestRoundData();
        (PriceIntegrity.State state,) = integrity.evaluate(_inputs(o, ans));
        if (state == PriceIntegrity.State.OPEN) {
            lastOpenRoundId = rid;
            lastOpenPrice = ans > 0 ? uint256(ans) : 0;
            lastOpenStartedAt = st_;
            lastOpenUpdatedAt = upd;
            hasOpenPrint = true;
        }
        emit Poked(state, o.refPrice, o.observedAt);
    }

    /// @inheritdoc IAggregatorV3
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        require(hasObservation, "no observation yet");
        (uint80 rid, int256 ans, uint256 st_, uint256 upd, uint80 air) = underlying.latestRoundData();
        (PriceIntegrity.State state,) = integrity.evaluate(_inputs(obs, ans));

        if (state == PriceIntegrity.State.OPEN) {
            return (rid, ans, st_, upd, air);
        }
        if (state == PriceIntegrity.State.DISLOCATED) {
            require(hasOpenPrint && lastOpenPrice != 0, "no open print yet");
            return (rid, _clamp(ans), st_, upd, air);
        }
        if (state == PriceIntegrity.State.CLOSED || state == PriceIntegrity.State.REOPENING) {
            require(hasOpenPrint && lastOpenPrice != 0, "no open print yet");
            return (
                lastOpenRoundId,
                int256(lastOpenPrice),
                lastOpenStartedAt,
                lastOpenUpdatedAt,
                lastOpenRoundId
            );
        }
        revert("guarded feed halted"); // STALE, HALTED, CHAIN_DEGRADED
    }

    /// @inheritdoc IAggregatorV3
    /// @dev History is immutable: past rounds pass through unguarded. Only the
    /// *current* price is guarded (see latestRoundData).
    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return underlying.getRoundData(_roundId);
    }

    function decimals() external view override returns (uint8) {
        return underlying.decimals();
    }

    function description() external view override returns (string memory) {
        return underlying.description();
    }

    function version() external view override returns (uint256) {
        return underlying.version();
    }

    // --- internals ---

    function _inputs(Observation memory o, int256 feedAns)
        internal
    pure
        returns (PriceIntegrity.EvalInputs memory)
    {
        return PriceIntegrity.EvalInputs({
            refPrice: o.refPrice,
            refAt: o.observedAt,
            feedPrice: feedAns > 0 ? uint256(feedAns) : 0,
            marketStatus: o.marketStatus,
            haltFlag: o.haltFlag,
            chainDegraded: o.chainDegraded,
            prevRefPrice: o.prevRefPrice,
            prevRefAt: o.prevObservedAt
        });
    }

    /// @notice Clamp a dislocated print to last-open ± collarBps.
    function _clamp(int256 ans) internal view returns (int256) {
        uint256 lo = (lastOpenPrice * (10_000 - collarBps)) / 10_000;
        uint256 hi = (lastOpenPrice * (10_000 + collarBps)) / 10_000;
        if (ans < 0) return int256(lo);
        uint256 a = uint256(ans);
        if (a < lo) return int256(lo);
        if (a > hi) return int256(hi);
        return ans;
    }
}
