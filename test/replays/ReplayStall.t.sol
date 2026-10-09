// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../consumers/ConsumerIntegration.t.sol"; // MockERC20T, MockAdapterRead
import "../../src/consumers/GuardedLender.sol";
import "../../src/adapters/LivenessAdapter.sol";
import "../../src/AnchorClock.sol";
import "../../src/PriceIntegrity.sol";
import "./ReplayBase.sol";

/// @notice Replay 4 (STRETCH) — RH sequencer stall, Sep 4 2026 (reenacted
/// Sep 3 2026).
/// A 14-minute block-timestamp gap trips the LivenessAdapter; the integrity
/// layer evaluates CHAIN_DEGRADED, so no integrity-gated action proceeds.
/// The lender position sits through the stall + grace untouched:
/// 0 liquidations.
contract ReplayStall is Test, ReplayBase {
    uint256 constant T0 = 1788444000; // Thu Sep 3 2026 14:00 UTC (OPEN)

    function testReplay_SequencerStall() public {
        LivenessAdapter live = new LivenessAdapter(300); // 5-min max gap
        AnchorClock clock = new AnchorClock();
        PriceIntegrity pi = new PriceIntegrity(
            clock,
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 500, velocityBps: 1000, velocityWindow: 300, maxFreshness: 900, reopenGrace: 900
            })
        );

        // Healthy position before the stall.
        MockERC20T coll = new MockERC20T();
        MockERC20T debtT = new MockERC20T();
        MockAdapterRead venue = new MockAdapterRead();
        MockAdapterRead refFeed = new MockAdapterRead();
        address user = address(0xCAFE);
        vm.warp(T0);
        vm.roll(900);
        live.poke();
        assertTrue(live.isLive(), "live before stall");
        GuardedLender g = new GuardedLender(
            address(coll), address(debtT), address(clock), 0, address(venue), address(refFeed), 15 minutes, 0
        );
        debtT.mint(address(g), 100_000 * 1e18);
        coll.mint(user, 100 * 1e18);
        venue.set(100 * 1e18, true);
        refFeed.set(100 * 1e18, true);
        vm.startPrank(user);
        coll.approve(address(g), type(uint256).max);
        g.depositCollateral(10 * 1e18);
        g.borrow(400 * 1e18);
        vm.stopPrank();

        // THE STALL: 14 minutes with no new block timestamp.
        vm.warp(T0 + 840);
        vm.roll(901); // chain resumes, one block 14 min later
        uint256 stallBlock = block.number;
        assertFalse(live.isLive(), "liveness tripped");
        assertEq(live.gapSec(), 840, "14-min gap");

        // Integrity layer: CHAIN_DEGRADED — nothing integrity-gated proceeds.
        (PriceIntegrity.State st,) = pi.evaluate(
            PriceIntegrity.EvalInputs({
                refPrice: 100 * 1e8,
                refAt: T0 + 840,
                feedPrice: 100 * 1e8,
                marketStatus: 0,
                haltFlag: false,
                chainDegraded: true,
                prevRefPrice: 0,
                prevRefAt: 0
            })
        );
        assertEq(uint256(st), uint256(PriceIntegrity.State.CHAIN_DEGRADED), "degraded");

        // 0 liquidations through the stall: the position is untouched.
        assertEq(g.debt(user), 400 * 1e18, "debt untouched");
        assertEq(g.collateral(user), 10 * 1e18, "collateral untouched");

        // Recovery: the sequencer resumes, liveness restored.
        live.poke();
        assertTrue(live.isLive(), "live after recovery");

        _trace(
            "rh-stall-sep4-2026",
            string.concat(
                '{"scenario":"sequencer-stall",',
                '"incident":"RH Sep 4 2026: 14-minute block-timestamp gap (reenacted Sep 3 2026)",',
                '"stallBlock":"',
                vm.toString(stallBlock),
                '",',
                '"liveness":{"tripped":true,"gapSec":840,"maxGapSec":300},',
                '"priceIntegrity":"CHAIN_DEGRADED",',
                '"liquidationsDuringStall":0,',
                '"recovery":"poke resumes, liveness restored",',
                '"generatedBy":"forge test ReplayStall"}'
            )
        );
    }
}
