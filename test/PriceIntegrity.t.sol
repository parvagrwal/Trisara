// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AnchorClock.sol";
import "../src/PriceIntegrity.sol";

/// @notice TDD tests for PriceIntegrity — the per-asset state machine.
/// States: OPEN, CLOSED, REOPENING, STALE, DISLOCATED, HALTED, CHAIN_DEGRADED.
/// Plan refs: Day 2 core, PRD §5 #2, INV-4 (fail closed), INV-6 (pure replay).
/// v2: the clock sets the regime before price checks — a wandering weekend
/// feed is CLOSED (the close stands), not dislocated.
contract PriceIntegrityTest is Test {
    AnchorClock internal clock;
    PriceIntegrity internal pi; // EQUITY_US anchor

    PriceIntegrity.AssetConfig internal cfg;

    AnchorClock.Anchor internal constant EQUITY = AnchorClock.Anchor.EQUITY_US;

    // Timestamps (all verified against `date`):
    uint256 internal constant SAT = 1791633600; // Sat 2026-10-10 12:00 UTC
    uint256 internal constant MON_OPEN = 1791811800; // Mon 2026-10-12 13:30 UTC (09:30 ET)
    uint256 internal constant MON_935ET = 1791812100; // Mon 13:35 UTC, inside grace
    uint256 internal constant MON_10ET = 1791813600; // Mon 14:00 UTC, past grace

    function setUp() public {
        clock = new AnchorClock();
        cfg = PriceIntegrity.AssetConfig({
            deviationBps: 200, // 2%
            velocityBps: 500, // 5% inside the window
            velocityWindow: 300, // 5 min
            maxFreshness: 900, // 15 min
            reopenGrace: 900 // 15 min
        });
        pi = new PriceIntegrity(clock, EQUITY, cfg);
    }

    function _base() internal pure returns (PriceIntegrity.EvalInputs memory x) {
        x = PriceIntegrity.EvalInputs({
            refPrice: 100 * 1e8,
            refAt: MON_10ET,
            feedPrice: 100 * 1e8,
            marketStatus: 1,
            haltFlag: false,
            chainDegraded: false,
            prevRefPrice: 100 * 1e8,
            prevRefAt: MON_10ET - 60
        });
    }

    function _stateAt(PriceIntegrity.EvalInputs memory x, uint256 t) internal returns (PriceIntegrity.State) {
        vm.warp(t);
        (PriceIntegrity.State s,) = pi.evaluate(x);
        return s;
    }

    // --- OPEN: Monday 10:00 ET, everything agrees ---
    function test_OpenSessionFresh() public {
        assertEq(uint256(_stateAt(_base(), MON_10ET)), uint256(PriceIntegrity.State.OPEN));
    }

    // --- CLOSED: Saturday, venue shut ---
    function test_WeekendClosed() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refAt = SAT;
        x.prevRefAt = SAT - 60;
        assertEq(uint256(_stateAt(x, SAT)), uint256(PriceIntegrity.State.CLOSED));
    }

    // --- v2: Saturday + wandering feed -> CLOSED. The close stands; there is
    // no live market to disagree with, so the deviation is not interrogated.
    function test_WeekendFeedWanderIgnored() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refPrice = 100 * 1e8; // the close
        x.feedPrice = 30 * 1e8; // weekend garbage print (-70%)
        x.refAt = SAT;
        x.prevRefPrice = 100 * 1e8;
        x.prevRefAt = SAT - 60;
        assertEq(uint256(_stateAt(x, SAT)), uint256(PriceIntegrity.State.CLOSED));
    }

    // --- REOPENING: Monday 9:35 ET, inside the 15-min grace ---
    function test_ReopeningWithinGrace() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refAt = MON_935ET;
        x.prevRefAt = MON_935ET - 60;
        assertEq(uint256(_stateAt(x, MON_935ET)), uint256(PriceIntegrity.State.REOPENING));
    }

    // --- STALE: keeper went quiet intraday (just over 15 min) ---
    function test_StaleAfterGraceExpires() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refAt = MON_10ET - 901;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.STALE));
    }

    function test_StaleIntraday() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refAt = MON_10ET - 2000;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.STALE));
    }

    // --- DISLOCATED: reference jumped 6% in 2 minutes (velocity) ---
    function test_VelocityTrip() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.prevRefPrice = 100 * 1e8;
        x.prevRefAt = MON_10ET - 120;
        x.refPrice = 106 * 1e8;
        x.feedPrice = 106 * 1e8; // feed tracks: purely a velocity trip
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.DISLOCATED));
    }

    // --- DISLOCATED: zero reference fails closed ---
    function test_ZeroReferenceFailsClosed() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.refPrice = 0;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.DISLOCATED));
    }

    // --- HALTED beats everything, even a perfect market ---
    function test_HaltFlagAlwaysWins() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.haltFlag = true;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.HALTED));
    }

    function test_ChainDegraded() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.chainDegraded = true;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.CHAIN_DEGRADED));
    }

    // --- Chainlink marketStatus tightens: explicit closed code shuts us ---
    function test_MarketStatusTighten() public {
        PriceIntegrity.EvalInputs memory x = _base();
        x.marketStatus = 2;
        assertEq(uint256(_stateAt(x, MON_10ET)), uint256(PriceIntegrity.State.CLOSED));
    }

    // --- Oct 12 divergence: bank anchor shut while NYSE trades ---
    function test_Oct12BankAnchorClosed() public {
        PriceIntegrity bankPi = new PriceIntegrity(clock, AnchorClock.Anchor.BANK_US, cfg);
        PriceIntegrity.EvalInputs memory x = _base();
        x.refAt = 1791813600; // Mon 2026-10-12 14:00 UTC
        x.prevRefAt = 1791813600 - 60;
        vm.warp(1791813600);
        (PriceIntegrity.State s,) = bankPi.evaluate(x);
        assertEq(uint256(s), uint256(PriceIntegrity.State.CLOSED));
    }
}
