// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/Rulebook.sol";

/// @notice TDD tests for Rulebook — pre-committed, bounded, auto-expiring rules.
/// Plan refs: Day 2 core, PRD §5 #3. INV-2 (expiry), INV-3 (timelock), INV-5 (exits).
contract RulebookTest is Test {
    Rulebook internal rb;
    address internal admin = address(0xA11CE);
    address internal flagger = address(0xF1A66E2);
    uint256 internal constant TIMELOCK = 24 hours;

    bytes32 internal constant HIMS = bytes32("HIMS");
    Rulebook.ActionClass internal constant SWAP = Rulebook.ActionClass.SWAP;

    function setUp() public {
        rb = new Rulebook(admin, flagger, TIMELOCK);
    }

    function _rule(Rulebook.Action a, uint256 p, uint64 e, bytes32 r) internal pure returns (Rulebook.Rule memory) {
        return Rulebook.Rule({action: a, param: p, expiresAt: e, reasonCode: r});
    }

    function _key() internal view returns (bytes32) {
        return rb.ruleKey(HIMS, SWAP);
    }

    // --- default deny: no published rule -> HALT (fail closed) ---
    function test_DefaultNoRuleHalts() public view {
        (Rulebook.Action a,, bytes32 reason) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
        assertEq(reason, bytes32("NO_RULE"));
    }

    // --- first publish applies instantly ---
    function test_SetAllowInstant() public {
        vm.prank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("OPEN_WEEK")));
        (Rulebook.Action a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.ALLOW));
    }

    // --- tightening is instant: ALLOW -> HALT ---
    function test_TightenInstant() public {
        vm.startPrank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("OPEN")));
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 3600), bytes32("WEEKEND")));
        vm.stopPrank();
        (Rulebook.Action a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
    }

    // --- loosening waits: HALT -> ALLOW queues behind the timelock ---
    function test_LoosenQueued() public {
        vm.startPrank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 3600), bytes32("WEEKEND")));
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("REOPEN")));
        vm.stopPrank();

        // Still HALT before the eta.
        (Rulebook.Action a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));

        // After the eta anyone can execute it.
        vm.warp(block.timestamp + TIMELOCK + 1);
        rb.executeQueuedRule(HIMS, SWAP);
        (a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.ALLOW));
    }

    // --- same-rank tightening via param: CAP 50% -> 30% is instant ---
    function test_TightenCapParamInstant() public {
        vm.startPrank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.CAP, 5000, 0, bytes32("CAP50")));
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.CAP, 3000, 0, bytes32("CAP30")));
        vm.stopPrank();
        (Rulebook.Action a, uint256 p,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.CAP));
        assertEq(p, 3000);
    }

    // --- same-rank loosening via param: CAP 30% -> 50% queues ---
    function test_LoosenCapParamQueued() public {
        vm.startPrank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.CAP, 3000, 0, bytes32("CAP30")));
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.CAP, 5000, 0, bytes32("CAP50")));
        vm.stopPrank();
        (, uint256 p,) = rb.decision(HIMS, SWAP);
        assertEq(p, 3000, "loosening must wait for timelock");
    }

    // --- instant tighten cancels a queued loosening ---
    function test_TightenCancelsPendingLoosening() public {
        vm.startPrank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 7200), bytes32("WEEKEND")));
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("REOPEN"))); // queued
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 7200), bytes32("STILL_SHUT"))); // instant tighten
        vm.stopPrank();

        vm.warp(block.timestamp + TIMELOCK + 1);
        vm.expectRevert("no queued rule");
        rb.executeQueuedRule(HIMS, SWAP);
        (Rulebook.Action a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
    }

    // --- INV-5: exit classes can never be restricted ---
    function test_ExitAlwaysOpen() public {
        vm.prank(admin);
        vm.expectRevert("exits always open");
        rb.setRule(
            HIMS,
            Rulebook.ActionClass.EXIT,
            _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 3600), bytes32("X"))
        );
        (Rulebook.Action a,, bytes32 reason) = rb.decision(HIMS, Rulebook.ActionClass.EXIT);
        assertEq(uint256(a), uint256(Rulebook.Action.ALLOW));
        assertEq(reason, bytes32("EXIT_ALWAYS_OPEN"));
    }

    // --- flagger: tighten-only emergency brake ---
    function test_FlagTighten() public {
        vm.prank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("OPEN")));
        vm.prank(flagger);
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("SQUEEZE"));
        (Rulebook.Action a,, bytes32 reason) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
        assertEq(reason, bytes32("SQUEEZE"));
    }

    function test_FlagCannotLoosen() public {
        vm.prank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 3600), bytes32("WEEKEND")));
        vm.prank(flagger);
        vm.expectRevert("flag would loosen");
        rb.flag(HIMS, SWAP, Rulebook.Action.COLLAR, 3600, bytes32("X"));
    }

    // --- INV-2: flags auto-expire ---
    function test_FlagExpiry() public {
        vm.prank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("OPEN")));
        vm.prank(flagger);
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("SQUEEZE"));
        vm.warp(block.timestamp + 3601);
        (Rulebook.Action a,,) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.ALLOW), "expired flag must release");
    }

    function test_FlagRateLimit() public {
        vm.prank(flagger);
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 1800, bytes32("A"));
        vm.prank(flagger);
        vm.expectRevert("rate-limited");
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 1800, bytes32("B"));
        vm.warp(block.timestamp + 3601);
        vm.prank(flagger);
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 1800, bytes32("C")); // ok after cooldown
    }

    function test_FlagMaxHalt() public {
        vm.prank(flagger);
        vm.expectRevert("bad duration");
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 7 hours, bytes32("X"));
    }

    // --- permissions ---
    function test_NonAdminCannotSetRule() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not admin");
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.ALLOW, 0, 0, bytes32("X")));
    }

    function test_NonFlaggerCannotFlag() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not flagger");
        rb.flag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
    }

    // --- INV-2: venue HALT rules must expire within maxHalt ---
    function test_HaltRuleMustExpire() public {
        vm.prank(admin);
        vm.expectRevert("halt must expire");
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, 0, bytes32("FOREVER")));

        vm.prank(admin);
        vm.expectRevert("halt exceeds maxHalt");
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.HALT, 0, uint64(block.timestamp + 7 hours), bytes32("LONG")));
    }

    // --- expired venue rules fall back to HALT ---
    function test_RuleExpiry() public {
        vm.prank(admin);
        rb.setRule(HIMS, SWAP, _rule(Rulebook.Action.CAP, 5000, uint64(block.timestamp + 3600), bytes32("CAP")));
        vm.warp(block.timestamp + 3601);
        (Rulebook.Action a,, bytes32 reason) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
        assertEq(reason, bytes32("RULE_EXPIRED"));
    }
}
