// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../consumers/ConsumerIntegration.t.sol"; // MockERC20T, MockAdapterRead
import "../../src/consumers/GuardedLender.sol";
import "../../src/AnchorClock.sol";
import "./ReplayBase.sol";

/// @notice Replay 2 — HL JELLY, March 2025 (reenacted on a 2026 session date;
/// the AnchorClock only covers 2026-2027).
/// Thin-market venue print crashes 10x while the reference (oraclePx) holds.
/// GuardedLender: 0 liquidations (healthy on refFeed). Unguarded twin:
/// liquidates on the manipulated venue print.
contract ReplayJelly is Test, ReplayBase {
    uint256 constant DAY = 1781100000; // Wed Jun 10 2026 14:00 UTC (OPEN)

    function testReplay_JellySqueeze() public {
        MockERC20T coll = new MockERC20T();
        MockERC20T debtT = new MockERC20T();
        MockAdapterRead venue = new MockAdapterRead();
        MockAdapterRead refFeed = new MockAdapterRead();
        AnchorClock clock = new AnchorClock();
        address user = address(0xCAFE);
        address liq = address(0xA11CE);

        vm.warp(DAY);
        GuardedLender g = new GuardedLender(
            address(coll), address(debtT), address(clock), 0, address(venue), address(refFeed), 15 minutes, 0
        );
        UnguardedLender u = new UnguardedLender(address(coll), address(debtT), address(venue));
        debtT.mint(address(g), 100_000 * 1e18);
        debtT.mint(address(u), 100_000 * 1e18);
        coll.mint(user, 100 * 1e18);

        venue.set(100 * 1e18, true);
        refFeed.set(100 * 1e18, true);

        // 10 coll @ $100 = $1,000 value; borrow $400 (40% LTV, healthy).
        vm.startPrank(user);
        coll.approve(address(g), type(uint256).max);
        g.depositCollateral(10 * 1e18);
        g.borrow(400 * 1e18);
        coll.approve(address(u), type(uint256).max);
        u.depositCollateral(10 * 1e18);
        u.borrow(400 * 1e18);
        vm.stopPrank();

        // THE SQUEEZE: thin-market venue print crashes 10x; oraclePx steady.
        vm.roll(510); // trip block
        uint256 tripBlock = block.number;
        venue.set(10 * 1e18, true);

        // Guarded: liquidation reverts — the account is healthy on refFeed.
        debtT.mint(liq, 10_000 * 1e18);
        vm.startPrank(liq);
        debtT.approve(address(g), type(uint256).max);
        vm.expectRevert("healthy on refFeed");
        g.liquidate(user);
        vm.stopPrank();
        assertEq(g.debt(user), 400 * 1e18, "guarded debt untouched");

        // Unguarded: liquidates immediately on the manipulated print.
        vm.startPrank(liq);
        debtT.approve(address(u), type(uint256).max);
        u.liquidate(user);
        vm.stopPrank();
        assertEq(u.debt(user), 0, "unguarded liquidated on squeeze");

        _trace(
            "jelly-mar2025",
            string.concat(
                '{"scenario":"jelly-squeeze",',
                '"incident":"HL JELLY March 2025: thin-market venue print crashes 10x while oraclePx holds (reenacted Jun 10 2026 session)",',
                '"tripBlock":"',
                vm.toString(tripBlock),
                '",',
                '"guarded":{"liquidations":0,"debtAfter":"400.00"},',
                '"unguarded":{"liquidations":1,"debtAfter":"0.00"},',
                '"mechanism":"liquidation trigger reads refFeed only (INV-7); venue manipulation cannot liquidate",',
                '"generatedBy":"forge test ReplayJelly"}'
            )
        );
    }
}
