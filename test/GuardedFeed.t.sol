// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/GuardedFeed.sol";
import "../src/PriceIntegrity.sol";
import "../src/AnchorClock.sol";

/// @notice Controllable stand-in for the underlying Chainlink feed.
contract MockFeed is IAggregatorV3 {
    uint80 public rid = 1;
    int256 public ans;
    uint256 public st;
    uint256 public upd;

    function setPrice(int256 a, uint256 t) external {
        ans = a;
        st = t;
        upd = t;
        rid++;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "MOCK / USD";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (rid, ans, st, upd, rid);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (rid, ans, st, upd, rid);
    }
}

/// @notice TDD tests for GuardedFeed — the Chainlink drop-in.
/// Plan refs: Day 2 core. Behavior per integrity state:
/// OPEN -> passthrough | DISLOCATED -> clamp | CLOSED/REOPENING -> last open print | else revert.
contract GuardedFeedTest is Test {
    MockFeed internal feed;
    AnchorClock internal clock;
    PriceIntegrity internal pi;
    GuardedFeed internal gf;
    address internal keeper = address(0xBEEF);

    // Mon 2026-10-05 14:00 UTC = 10:00 ET: safely inside the session (past grace).
    uint256 internal constant MON_TRADE = 1791208800;
    // Tue 2026-10-06 13:35 UTC = 9:35 ET: inside Tuesday's reopening grace.
    uint256 internal constant TUE_GRACE = 1791293700;
    uint256 internal constant SAT = 1791633600; // Sat 2026-10-10 12:00 UTC
    uint256 internal constant P100 = 100 * 1e8;

    function setUp() public {
        feed = new MockFeed();
        clock = new AnchorClock();
        pi = new PriceIntegrity(
            clock,
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 200, velocityBps: 500, velocityWindow: 300, maxFreshness: 900, reopenGrace: 900
            })
        );
        gf = new GuardedFeed(address(feed), address(pi), keeper, 100); // ±1% collar
    }

    function _obs(uint256 refPrice, uint256 at) internal pure returns (GuardedFeed.Observation memory) {
        return GuardedFeed.Observation({
            refPrice: refPrice,
            observedAt: at,
            marketStatus: 1,
            haltFlag: false,
            chainDegraded: false,
            prevRefPrice: refPrice,
            prevObservedAt: at - 60
        });
    }

    /// @notice Record an open-session print the later tests defer to.
    function _recordOpenPrint() internal {
        vm.warp(MON_TRADE);
        feed.setPrice(int256(P100), MON_TRADE);
        vm.prank(keeper);
        gf.poke(_obs(P100, MON_TRADE));
    }

    /// @notice Open session: the underlying feed passes through untouched.
    function test_OpenPassthrough() public {
        _recordOpenPrint();
        (uint80 rid, int256 ans,, uint256 upd,) = gf.latestRoundData();
        assertEq(ans, int256(P100));
        assertEq(upd, MON_TRADE);
        assertEq(rid, feed.rid());
    }

    /// @notice Weekend: the venue is shut, so the last open print is the answer —
    /// even if the underlying feed printed garbage while nobody was watching.
    function test_ClosedReturnsLastOpenPrint() public {
        _recordOpenPrint();

        vm.warp(SAT);
        feed.setPrice(int256(50 * 1e8), SAT); // weekend garbage print
        vm.prank(keeper);
        gf.poke(_obs(P100, SAT)); // reference is still the close

        (, int256 ans,, uint256 upd,) = gf.latestRoundData();
        assertEq(ans, int256(P100), "weekend must defer to the last open print");
        assertEq(upd, MON_TRADE, "timestamp must be the print's, not now");
    }

    /// @notice Just after Tuesday's bell: still the close until the grace ends.
    function test_ReopeningReturnsLastOpenPrint() public {
        _recordOpenPrint();

        vm.warp(TUE_GRACE);
        feed.setPrice(int256(105 * 1e8), TUE_GRACE);
        vm.prank(keeper);
        gf.poke(_obs(105 * 1e8, TUE_GRACE));

        (, int256 ans,,,) = gf.latestRoundData();
        assertEq(ans, int256(P100), "grace window must defer to the close");
    }

    /// @notice Live market, feed dislocated: clamp to last-open ±1%.
    function test_DislocatedClamps() public {
        _recordOpenPrint();

        vm.warp(MON_TRADE + 120);
        feed.setPrice(int256(150 * 1e8), MON_TRADE + 120); // +50% dislocation
        // No re-poke: the keeper's observation still says ref 100.

        (, int256 ans,,,) = gf.latestRoundData();
        assertEq(ans, int256(101 * 1e8), "must clamp to last-open +1%");
    }

    /// @notice Keeper went quiet intraday: revert rather than invent a price.
    function test_StaleReverts() public {
        _recordOpenPrint();

        vm.warp(MON_TRADE + 901); // past 15-min maxFreshness
        vm.expectRevert("guarded feed halted");
        gf.latestRoundData();
    }

    function test_HaltedReverts() public {
        vm.warp(MON_TRADE);
        feed.setPrice(int256(P100), MON_TRADE);
        GuardedFeed.Observation memory o = _obs(P100, MON_TRADE);
        o.haltFlag = true;
        vm.prank(keeper);
        gf.poke(o);
        vm.expectRevert("guarded feed halted");
        gf.latestRoundData();
    }

    function test_ChainDegradedReverts() public {
        vm.warp(MON_TRADE);
        feed.setPrice(int256(P100), MON_TRADE);
        GuardedFeed.Observation memory o = _obs(P100, MON_TRADE);
        o.chainDegraded = true;
        vm.prank(keeper);
        gf.poke(o);
        vm.expectRevert("guarded feed halted");
        gf.latestRoundData();
    }

    function test_NonKeeperCannotPoke() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("not keeper");
        gf.poke(_obs(P100, MON_TRADE));
    }

    function test_DecimalsPassthrough() public view {
        assertEq(gf.decimals(), 8);
        assertEq(gf.description(), "MOCK / USD");
    }

    /// @notice Each OPEN poke refreshes the close the feed defers to.
    function test_LastOpenUpdatesOnPoke() public {
        _recordOpenPrint();

        uint256 later = MON_TRADE + 3600;
        vm.warp(later);
        feed.setPrice(int256(102 * 1e8), later);
        vm.prank(keeper);
        gf.poke(_obs(102 * 1e8, later));

        vm.warp(SAT);
        vm.prank(keeper);
        gf.poke(_obs(102 * 1e8, SAT));
        (, int256 ans,, uint256 upd,) = gf.latestRoundData();
        assertEq(ans, int256(102 * 1e8), "must defer to the latest open print");
        assertEq(upd, later);
    }

    /// @notice Fresh deployment, venue already shut: no print to defer to -> revert.
    function test_NoOpenPrintReverts() public {
        vm.warp(SAT);
        feed.setPrice(int256(P100), SAT);
        vm.prank(keeper);
        gf.poke(_obs(P100, SAT));
        vm.expectRevert("no open print yet");
        gf.latestRoundData();
    }
}
