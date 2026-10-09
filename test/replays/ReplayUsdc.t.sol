// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../consumers/ConsumerIntegration.t.sol"; // MockERC20T, MockAdapterRead, MockPolicy
import "../../src/consumers/GuardedSettlementRouter.sol";
import "../../src/AnchorClock.sol";
import "./ReplayBase.sol";

/// @notice Replay 3 — Tempo USDC, Mar 10-13 2023 + TIP-403 (reenacted on a
/// 2026 Saturday; the AnchorClock only covers 2026-2027).
/// USDC prints $0.87 while the Fed bank anchor is CLOSED: the guarded router
/// halts USDC at-par acceptance (refundable hold) and the payer routes to a
/// healthy coin, so the merchant receives 100% of the $10,000 invoice.
/// The unguarded twin pays $10,000 USDC at par -> $8,700 of value ($1,300 loss).
/// A TIP-403-blocked payee enters COMPLIANCE_HOLD and refunds cleanly.
contract ReplayUsdc is Test, ReplayBase {
    uint256 constant SAT = 1773489600; // Sat Mar 14 2026 12:00 UTC (Fed CLOSED)

    struct Fx {
        MockERC20T usdc;
        MockERC20T dai;
        MockAdapterRead pegUsdc;
        MockAdapterRead pegDai;
        MockPolicy policy;
        AnchorClock clock;
        GuardedSettlementRouter gUsdc;
        GuardedSettlementRouter gDai;
        UnguardedSettlementRouter u;
        address user;
        address merchant;
    }

    function testReplay_UsdcDepeg() public {
        Fx memory f = _deploy();
        vm.warp(SAT);
        vm.roll(700); // trip block
        assertFalse(f.clock.isOpen(AnchorClock.Anchor.BANK_US, block.timestamp), "fed closed saturday");

        // Saturday: USDC prints $0.87 while banks are shut -> peg break.
        // DAI holds its peg.
        f.pegUsdc.set(0, false);
        f.pegDai.set(1 * 1e18, true);

        // Guarded: USDC at-par acceptance HALTED -> refundable hold, merchant gets 0.
        vm.startPrank(f.user);
        f.usdc.approve(address(f.gUsdc), type(uint256).max);
        f.gUsdc.settle(address(f.usdc), f.merchant, 10_000 * 1e18, bytes32("inv-usdc"));
        vm.stopPrank();
        assertEq(f.usdc.balanceOf(f.merchant), 0, "no at-par USDC while pegged at 0.87");
        (,,,, bytes32 reason1,,) = f.gUsdc.holds(1);
        assertEq(reason1, bytes32("PEG_BREAK_CLOSED"), "hold reason");

        // Payer routes to the healthy coin: merchant receives the full $10,000.
        vm.startPrank(f.user);
        f.dai.approve(address(f.gDai), type(uint256).max);
        f.gDai.settle(address(f.dai), f.merchant, 10_000 * 1e18, bytes32("inv-dai"));
        vm.stopPrank();
        assertEq(f.dai.balanceOf(f.merchant), 10_000 * 1e18, "merchant made whole");

        _tip403AndUnguarded(f);

        _trace(
            "usdc-mar2023",
            string.concat(
                '{"scenario":"usdc-depeg-tip403",',
                '"incident":"USDC Mar 11 2023: $0.87 Saturday print while Fed anchor CLOSED (reenacted Mar 14 2026)",',
                '"tripBlock":700,',
                '"guarded":{"usdcAtPar":"HALTED (PEG_BREAK_CLOSED hold)","merchantReceivedUsd":"10000.00",',
                '"tip403":{"payee":"COMPLIANCE_HOLD","refund":"clean"}},',
                '"unguarded":{"paidUsdcAtPar":10000,"valueUsd":"8700.00","lossUsd":"1300.00"},',
                '"generatedBy":"forge test ReplayUsdc"}'
            )
        );
    }

    function _deploy() internal returns (Fx memory f) {
        f.usdc = new MockERC20T();
        f.dai = new MockERC20T();
        f.pegUsdc = new MockAdapterRead();
        f.pegDai = new MockAdapterRead();
        f.policy = new MockPolicy();
        f.clock = new AnchorClock();
        f.user = address(0xCAFE);
        f.merchant = address(0xFACE);
        address keeper = address(0xBEEF);

        address[] memory tokens = new address[](2);
        tokens[0] = address(f.usdc);
        tokens[1] = address(f.dai);
        // One router per peg feed, as deployed: the USDC leg reads the
        // broken USDC peg, the DAI leg reads the healthy DAI peg.
        f.gUsdc =
            new GuardedSettlementRouter(tokens, address(f.pegUsdc), address(f.clock), 1, address(f.policy), 30, keeper);
        f.gDai =
            new GuardedSettlementRouter(tokens, address(f.pegDai), address(f.clock), 1, address(f.policy), 30, keeper);
        f.u = new UnguardedSettlementRouter();

        f.usdc.mint(f.user, 100_000 * 1e18);
        f.dai.mint(f.user, 100_000 * 1e18);
        f.policy.setAuth(f.user, true);
        f.policy.setAuth(f.merchant, true);
    }

    function _tip403AndUnguarded(Fx memory f) internal {
        // TIP-403: blocked payee -> COMPLIANCE_HOLD -> clean refund, nothing stuck.
        address blocked = address(0xBAD);
        f.policy.setAuth(blocked, false);
        vm.startPrank(f.user);
        f.dai.approve(address(f.gDai), type(uint256).max);
        f.gDai.settle(address(f.dai), blocked, 1_000 * 1e18, bytes32("inv-blocked"));
        vm.stopPrank();
        (,,,, bytes32 reason2,,) = f.gDai.holds(1);
        assertEq(reason2, bytes32("COMPLIANCE_HOLD"), "compliance hold");
        uint256 balBefore = f.dai.balanceOf(f.user);
        vm.prank(f.user);
        f.gDai.claimRefund(1);
        assertEq(f.dai.balanceOf(f.user), balBefore + 1_000 * 1e18, "refund clean");

        // Unguarded: pays $10,000 USDC at par -> worth $8,700 -> $1,300 loss.
        vm.startPrank(f.user);
        f.usdc.approve(address(f.u), type(uint256).max);
        f.u.settle(address(f.usdc), f.merchant, 10_000 * 1e18, bytes32("inv-unguarded"));
        vm.stopPrank();
        uint256 value = (f.usdc.balanceOf(f.merchant) * 87) / 100; // 10,000 USDC at $0.87
        assertEq(10_000 * 1e18 - value, 1300 * 1e18, "unguarded loss $1,300");
    }
}
