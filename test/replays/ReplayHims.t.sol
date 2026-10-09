// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../consumers/ConsumerIntegration.t.sol"; // MockERC20T, MockFeed
import "../../src/consumers/GuardedSwapRouter.sol";
import "../../src/AnchorClock.sol";
import "../../src/PriceIntegrity.sol";
import "./ReplayBase.sol";

/// @notice Replay 1 — RH HIMS, Aug 29-31 2026.
/// $28.84 Friday close -> $132.64 weekend pool print (+360%).
/// Guarded swap router DEFERS (0 fills outside the +/-5% collar);
/// the unguarded twin fills at the dislocated print (~$783 loss on $1k).
contract ReplayHims is Test, ReplayBase {
    uint256 constant FRI_CLOSE = 1787947200; // Fri Aug 28 20:00 UTC = 16:00 EDT
    uint256 constant SAT = 1788004800; // Sat Aug 29 12:00 UTC (venue CLOSED)
    uint256 constant MON_OPEN = 1788183000; // Mon Aug 31 13:30 UTC = 09:30 EDT

    // Feed: 8 decimals, price = tokenOut (HIMS) per tokenIn (USDC).
    // $28.84/HIMS  -> 1 USDC = 0.03467028 HIMS -> 3467028
    uint256 constant REF_PX = 3467028;
    // $132.64/HIMS -> 1 USDC = 0.00753927 HIMS -> 753927  (-78% vs ref)
    uint256 constant DIS_PX = 753927;

    function testReplay_HimsWeekendSpike() public {
        MockERC20T usdc = new MockERC20T();
        MockERC20T hims = new MockERC20T();
        MockFeed feed = new MockFeed();
        AnchorClock clock = new AnchorClock();
        address keeper = address(0xBEEF);
        address user = address(0xCAFE);

        vm.warp(FRI_CLOSE);
        GuardedSwapRouter g = new GuardedSwapRouter(address(feed), address(usdc), address(hims), 500, keeper, REF_PX);
        UnguardedSwapRouter u = new UnguardedSwapRouter(address(feed), address(usdc), address(hims));
        hims.mint(keeper, 10_000_000 * 1e18);
        vm.startPrank(keeper);
        hims.approve(address(g), type(uint256).max);
        g.fund(1_000_000 * 1e18);
        hims.approve(address(u), type(uint256).max);
        u.fund(1_000_000 * 1e18);
        vm.stopPrank();
        usdc.mint(user, 10_000 * 1e18);

        PriceIntegrity pi = new PriceIntegrity(
            clock,
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 500, velocityBps: 1000, velocityWindow: 300, maxFreshness: 900, reopenGrace: 900
            })
        );

        // --- Saturday: the pool print spikes +360% while the venue is shut.
        vm.warp(SAT);
        vm.roll(100);
        feed.setPrice(int256(DIS_PX));

        (PriceIntegrity.State st,) = pi.evaluate(
            PriceIntegrity.EvalInputs({
                refPrice: REF_PX,
                refAt: FRI_CLOSE,
                feedPrice: DIS_PX,
                marketStatus: 0,
                haltFlag: false,
                chainDegraded: false,
                prevRefPrice: 0,
                prevRefAt: 0
            })
        );
        assertEq(uint256(st), uint256(PriceIntegrity.State.CLOSED), "saturday: CLOSED");

        // Guarded: outside the +/-5% collar -> DEFERRED, nothing fills.
        vm.startPrank(user);
        usdc.approve(address(g), type(uint256).max);
        (uint256 id, uint256 out) = g.swap(1000 * 1e18);
        vm.stopPrank();
        assertTrue(id != 0, "guarded must defer");
        assertEq(out, 0, "no fill outside collar");
        assertEq(hims.balanceOf(user), 0, "user got nothing");

        // Unguarded: fills at the dislocated print.
        vm.startPrank(user);
        usdc.approve(address(u), type(uint256).max);
        uint256 uOut = u.swap(1000 * 1e18, 0);
        vm.stopPrank();
        uint256 trueValue = (uOut * 2884) / 100; // HIMS at the $28.84 close
        uint256 loss = 1000 * 1e18 - trueValue;
        assertGe(loss, 780 * 1e18, "loss ~$783");
        assertLe(loss, 786 * 1e18, "loss ~$783");

        // --- Monday, past the reopening grace: print still dislocated.
        vm.warp(MON_OPEN + 901);
        vm.roll(200);
        (st,) = pi.evaluate(
            PriceIntegrity.EvalInputs({
                refPrice: REF_PX,
                refAt: MON_OPEN + 840, // fresh reference print
                feedPrice: DIS_PX, // venue still shows the spike
                marketStatus: 0,
                haltFlag: false,
                chainDegraded: false,
                prevRefPrice: 0,
                prevRefAt: 0
            })
        );
        assertEq(uint256(st), uint256(PriceIntegrity.State.DISLOCATED), "monday: DISLOCATED");

        // Print normalizes -> the deferred swap executes at the sane price.
        feed.setPrice(int256(REF_PX));
        vm.prank(user);
        g.executeDeferred(id);
        assertGt(hims.balanceOf(user), uOut, "deferred filled at sane price");

        // Monday-open feed outage -> instant refund, nothing escrowed.
        feed.setRevert(true);
        vm.startPrank(user);
        usdc.approve(address(g), type(uint256).max);
        (uint256 id2, uint256 out2) = g.swap(100 * 1e18);
        vm.stopPrank();
        assertEq(id2, 0, "halted feed: no escrow");
        assertEq(out2, 0, "halted feed: no fill");

        _trace(
            "hims-aug29-31-2026",
            string.concat(
                '{"scenario":"hims-weekend-spike",',
                '"incident":"RH HIMS Aug 29-31 2026: $28.84 Friday close -> $132.64 weekend pool print (+360%)",',
                '"tripBlock":100,',
                '"priceIntegrity":{"saturday":"CLOSED","mondayOpen":"DISLOCATED"},',
                '"guarded":{"action":"DEFERRED","fillsOutsideCollar":0,"lossUsd":"0.00"},',
                '"unguarded":{"action":"FILLED_AT_DISLOCATED","lossUsd":"',
                _usd(loss),
                '"},',
                '"mondayOutage":"halted feed -> instant refund, nothing escrowed",',
                '"generatedBy":"forge test ReplayHims"}'
            )
        );
    }
}
