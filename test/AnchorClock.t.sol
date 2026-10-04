// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AnchorClock.sol";

/// @notice TDD tests for AnchorClock — the session-aware clock every
/// guarded decision reads before acting on a price.
/// Plan refs: Day 2 core, S10 (Oct 12 divergence), INV-4 (fail closed).
contract AnchorClockTest is Test {
    AnchorClock internal clock;

    AnchorClock.Anchor internal constant EQUITY = AnchorClock.Anchor.EQUITY_US;
    AnchorClock.Anchor internal constant BANK = AnchorClock.Anchor.BANK_US;

    function setUp() public {
        clock = new AnchorClock();
    }

    // --- Plan-mandated anchor divergence: Oct 12 2026 (Columbus Day) ---
    // NYSE open, Federal Reserve closed. ts = 2026-10-12T14:00:00Z.
    function test_Oct12Divergence() public view {
        uint256 t = 1791813600;
        assertTrue(clock.isOpen(EQUITY, t), "NYSE should be OPEN Oct 12 14:00Z");
        assertFalse(clock.isOpen(BANK, t), "Fed should be CLOSED Oct 12 14:00Z");
    }

    // --- Weekends: everything closed ---
    function test_WeekendClosed() public view {
        uint256 t = 1791633600; // Sat 2026-10-10 12:00 UTC
        assertFalse(clock.isOpen(EQUITY, t), "equity closed Saturday");
        assertFalse(clock.isOpen(BANK, t), "bank closed Saturday");
    }

    // --- Regular session: Wed 2026-10-07 15:00 UTC = 11:00 ET (EDT) ---
    function test_RegularSessionOpen() public view {
        uint256 t = 1791385200;
        assertTrue(clock.isOpen(EQUITY, t), "equity open 11:00 ET Wednesday");
    }

    // --- Before the bell: Wed 2026-10-07 12:00 UTC = 08:00 ET ---
    function test_BeforeOpenClosed() public view {
        uint256 t = 1791374400;
        assertFalse(clock.isOpen(EQUITY, t), "equity closed 08:00 ET");
    }

    // --- Full holidays: Christmas 2026 (Friday) ---
    function test_ChristmasClosed() public view {
        uint256 t = 1798210800; // Fri 2026-12-25 15:00 UTC
        assertFalse(clock.isOpen(EQUITY, t), "equity closed Christmas");
        assertFalse(clock.isOpen(BANK, t), "bank closed Christmas");
    }

    // --- Thanksgiving 2026 (Thursday): both closed ---
    function test_ThanksgivingClosed() public view {
        uint256 t = 1795705200; // Thu 2026-11-26 15:00 UTC
        assertFalse(clock.isOpen(EQUITY, t), "equity closed Thanksgiving");
        assertFalse(clock.isOpen(BANK, t), "bank closed Thanksgiving");
    }

    // --- Fed-only holiday: Veterans Day 2026-11-11 (Wednesday) ---
    // NYSE trades; the bank anchor is shut.
    function test_VeteransDayFedOnly() public view {
        uint256 t = 1794409200; // Wed 15:00 UTC = 10:00 ET (EST)
        assertTrue(clock.isOpen(EQUITY, t), "equity open Veterans Day");
        assertFalse(clock.isOpen(BANK, t), "bank closed Veterans Day");
    }

    // --- NYSE-only holiday: Good Friday 2026-04-03 ---
    // Fed rails run; equities don't.
    function test_GoodFridayNyseOnly() public view {
        uint256 t = 1775228400; // Fri 15:00 UTC = 11:00 ET (EDT)
        assertFalse(clock.isOpen(EQUITY, t), "equity closed Good Friday");
        assertTrue(clock.isOpen(BANK, t), "bank open Good Friday");
    }

    // --- Early close: Fri 2026-11-27 (day after Thanksgiving), 13:00 ET ---
    // 17:00 UTC = 12:00 ET -> OPEN; 19:00 UTC = 14:00 ET -> CLOSED (EST).
    function test_EarlyCloseAfterThanksgiving() public view {
        assertTrue(clock.isOpen(EQUITY, 1795798800), "open before 13:00 ET early close");
        assertFalse(clock.isOpen(EQUITY, 1795806000), "closed after 13:00 ET early close");
    }

    // --- Chainlink marketStatus can only tighten, never loosen ---
    function test_MarketStatusTightenOnly() public view {
        uint256 openT = 1791385200; // calendar says OPEN
        uint256 shutT = 1791633600; // calendar says CLOSED (Saturday)

        assertFalse(
            clock.isOpen(EQUITY, openT, false),
            "marketStatus=false must close a calendar-open market"
        );
        assertTrue(
            clock.isOpen(EQUITY, openT, true),
            "marketStatus=true keeps a calendar-open market open"
        );
        assertFalse(
            clock.isOpen(EQUITY, shutT, true),
            "marketStatus=true must NOT open a calendar-closed market"
        );
    }

    // --- INV-4: outside the known calendar, fail closed ---
    function test_OutOfRangeFailClosed() public view {
        uint256 past = 1748779200; // 2025-06-01
        uint256 future = 1843473600; // 2028-06-01
        assertFalse(clock.isOpen(EQUITY, past), "fail closed before 2026");
        assertFalse(clock.isOpen(BANK, past), "fail closed before 2026");
        assertFalse(clock.isOpen(EQUITY, future), "fail closed after 2027");
        assertFalse(clock.isOpen(BANK, future), "fail closed after 2027");
    }
}
