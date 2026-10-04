// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./AnchorClock.sol";

/// @title PriceIntegrity
/// @notice Per-asset integrity state machine: combines the session clock, a
/// reference price, the venue feed price and operator flags into one state.
/// @dev v2 ordering — the CLOCK sets the regime before any price is
/// interrogated. When the venue is shut there is no live market, so the
/// close is the answer and CLOSED/REOPENING return before deviation, velocity
/// and freshness checks (those only make sense while the market is open).
/// Order (fail-closed): halt/degraded -> corrupt input -> clock regime ->
/// freshness (open sessions) -> velocity -> deviation -> OPEN.
/// Pure view of its inputs (INV-6): anyone can replay an evaluation offchain.
contract PriceIntegrity {
    enum State {
        OPEN,
        CLOSED,
        REOPENING,
        STALE,
        DISLOCATED,
        HALTED,
        CHAIN_DEGRADED
    }

    struct AssetConfig {
        uint256 deviationBps; // feed-vs-reference trip, bps
        uint256 velocityBps; // reference move trip inside velocityWindow, bps
        uint256 velocityWindow; // seconds
        uint256 maxFreshness; // reference older than this (open session) -> STALE
        uint256 reopenGrace; // seconds after the bell treated as REOPENING
    }

    struct EvalInputs {
        uint256 refPrice; // reference (e.g. Robinhood API), same decimals as feed
        uint256 refAt; // when the reference was observed
        uint256 feedPrice; // venue feed price (0 = missing)
        uint8 marketStatus; // Chainlink marketStatus code; 2 = closed (tighten-only)
        bool haltFlag; // venue halted the asset
        bool chainDegraded; // venue feed pipeline degraded
        uint256 prevRefPrice; // previous reference print (0 = none)
        uint256 prevRefAt;
    }

    AnchorClock public immutable clock;
    AnchorClock.Anchor public immutable anchor;
    // Config as individual immutables (Solidity forbids immutable structs).
    uint256 public immutable deviationBps;
    uint256 public immutable velocityBps;
    uint256 public immutable velocityWindow;
    uint256 public immutable maxFreshness;
    uint256 public immutable reopenGrace;

    constructor(AnchorClock _clock, AnchorClock.Anchor _anchor, AssetConfig memory _config) {
        require(address(_clock) != address(0), "zero clock");
        require(_config.deviationBps > 0 && _config.deviationBps <= 10_000, "bad deviationBps");
        require(_config.velocityWindow > 0, "bad velocityWindow");
        require(_config.maxFreshness > 0, "bad maxFreshness");
        clock = _clock;
        anchor = _anchor;
        deviationBps = _config.deviationBps;
        velocityBps = _config.velocityBps;
        velocityWindow = _config.velocityWindow;
        maxFreshness = _config.maxFreshness;
        reopenGrace = _config.reopenGrace;
    }

    /// @notice Evaluate the integrity state for an observation at block.timestamp.
    function evaluate(EvalInputs memory x) public view returns (State state, bytes32 reason) {
        if (x.haltFlag) return (State.HALTED, "halt flag");
        if (x.chainDegraded) return (State.CHAIN_DEGRADED, "chain degraded");
        if (x.refPrice == 0 || x.feedPrice == 0) return (State.DISLOCATED, "zero price");

        // The clock sets the regime. marketStatus is tighten-only: an explicit
        // closed code (2) shuts us; anything else defers to the clock.
        // NOTE: confirm the closed code against the live feed before mainnet.
        bool statusOpen = x.marketStatus != 2;
        uint256 now_ = block.timestamp;
        if (!clock.isOpen(anchor, now_, statusOpen)) {
            return (State.CLOSED, "venue closed");
        }
        // Open now, but the bell rang within reopenGrace -> still the close.
        if (reopenGrace > 0 && !clock.isOpen(anchor, now_ - reopenGrace, statusOpen)) {
            return (State.REOPENING, "reopening grace");
        }

        // Open session: the observation must be fresh (INV-4).
        if (now_ - x.refAt > maxFreshness) return (State.STALE, "stale reference");

        // Velocity: the reference moved impossibly fast inside the window.
        if (x.prevRefPrice != 0 && x.prevRefAt < x.refAt && x.refAt - x.prevRefAt <= velocityWindow) {
            if (_bpsMove(x.prevRefPrice, x.refPrice) > velocityBps) {
                return (State.DISLOCATED, "velocity breach");
            }
        }

        // Deviation: the venue feed disagrees with the reference.
        if (_bpsMove(x.refPrice, x.feedPrice) > deviationBps) {
            return (State.DISLOCATED, "deviation breach");
        }

        return (State.OPEN, "open");
    }

    // --- internals ---

    /// @notice Absolute move from a to b, in basis points of a.
    /// Capped: beyond type(uint256).max / 10_000 the true bps value exceeds any
    /// realistic threshold (max 10_000), so it trips every check without overflowing.
    function _bpsMove(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == b) return 0;
        uint256 diff = a > b ? a - b : b - a;
        if (diff > type(uint256).max / 10_000) return type(uint256).max;
        return (diff * 10_000) / a;
    }
}
