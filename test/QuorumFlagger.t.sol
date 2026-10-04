// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/QuorumFlagger.sol";
import "../src/Rulebook.sol";

/// @notice TDD tests for QuorumFlagger — M-of-N emergency flags.
/// Plan refs: Day 2 stretch (was on hold; Parv chose to build).
contract QuorumFlaggerTest is Test {
    Rulebook internal rb;
    QuorumFlagger internal qf;
    address internal admin = address(0xAD11CE);

    address internal m1 = address(0xA11CE);
    address internal m2 = address(0xB0B);
    address internal m3 = address(0xCC);

    bytes32 internal constant HIMS = bytes32("HIMS");
    Rulebook.ActionClass internal constant SWAP = Rulebook.ActionClass.SWAP;

    function setUp() public {
        // Both contracts are immutable: precompute the quorum address so the
        // Rulebook can name it as flagger before it exists.
        uint256 nonce = vm.getNonce(address(this));
        address futureQF = vm.computeCreateAddress(address(this), nonce + 1);
        rb = new Rulebook(admin, futureQF, 24 hours);
        address[] memory members = new address[](3);
        members[0] = m1;
        members[1] = m2;
        members[2] = m3;
        qf = new QuorumFlagger(address(rb), members, 2);
        assertEq(address(qf), futureQF, "quorum address mismatch");
    }

    // --- 2-of-3: propose + one approval executes ---
    function test_ProposeAndExecute2of3() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("SQUEEZE"));
        assertEq(id, 0);

        // One approval is not enough: no flag exists yet.
        // (decision() is HALT by default-deny even with no rule — check the flag.)
        (,,, bool exists) = rb.flags(rb.ruleKey(HIMS, SWAP));
        assertFalse(exists, "must not execute before threshold");

        vm.prank(m2);
        qf.approve(id);

        (Rulebook.Action a2,, bytes32 reason) = rb.decision(HIMS, SWAP);
        assertEq(uint256(a2), uint256(Rulebook.Action.HALT));
        assertEq(reason, bytes32("SQUEEZE"));
    }

    // --- threshold 1: proposing executes immediately ---
    function test_Threshold1Immediate() public {
        address[] memory members = new address[](1);
        members[0] = m1;
        // fresh rulebook naming a 1-of-1 quorum
        uint256 nonce = vm.getNonce(address(this));
        address futureQF = vm.computeCreateAddress(address(this), nonce + 1);
        Rulebook rb2 = new Rulebook(admin, futureQF, 24 hours);
        QuorumFlagger qf1 = new QuorumFlagger(address(rb2), members, 1);

        vm.prank(m1);
        qf1.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("SOLO"));
        (Rulebook.Action a,,) = rb2.decision(HIMS, SWAP);
        assertEq(uint256(a), uint256(Rulebook.Action.HALT));
    }

    // --- non-members are locked out ---
    function test_NonMemberCannotPropose() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not member");
        qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
    }

    function test_NonMemberCannotApprove() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
        vm.prank(address(0xBEEF));
        vm.expectRevert("not member");
        qf.approve(id);
    }

    // --- one approval per member ---
    function test_DoubleApproveReverts() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
        vm.prank(m1);
        vm.expectRevert("already approved");
        qf.approve(id);
    }

    // --- proposals die after 24h ---
    function test_ProposalExpiry() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(m2);
        vm.expectRevert("proposal expired");
        qf.approve(id);
    }

    // --- tighten-only, enforced at propose time (fail fast) ---
    function test_TightenOnlyAtPropose() public {
        vm.prank(m1);
        vm.expectRevert("tighten-only");
        qf.proposeFlag(HIMS, SWAP, Rulebook.Action.ALLOW, 3600, bytes32("X"));
        vm.prank(m1);
        vm.expectRevert("tighten-only");
        qf.proposeFlag(HIMS, SWAP, Rulebook.Action.CAP, 3600, bytes32("X"));
    }

    // --- duration bounded at propose time ---
    function test_DurationBounded() public {
        vm.prank(m1);
        vm.expectRevert("bad duration");
        qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 0, bytes32("X"));
        vm.prank(m1);
        vm.expectRevert("bad duration");
        qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, uint64(7 hours), bytes32("X"));
    }

    // --- the executed flag is a real Rulebook flag (expiry, rate-limit apply) ---
    function test_FlagLandsOnRulebook() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("SQUEEZE"));
        vm.prank(m2);
        qf.approve(id);

        // Rulebook state: flag exists, expires in ~1h.
        (Rulebook.Action fa, uint64 expiresAt,, bool exists) = rb.flags(rb.ruleKey(HIMS, SWAP));
        assertTrue(exists);
        assertEq(uint256(fa), uint256(Rulebook.Action.HALT));
        assertLe(expiresAt - block.timestamp, 3600);

        // A second quorum flag right away hits the Rulebook rate limit.
        vm.prank(m1);
        uint256 id2 = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("AGAIN"));
        vm.prank(m2);
        vm.expectRevert("rate-limited");
        qf.approve(id2);
    }

    function test_ApproveExecutedReverts() public {
        vm.prank(m1);
        uint256 id = qf.proposeFlag(HIMS, SWAP, Rulebook.Action.HALT, 3600, bytes32("X"));
        vm.prank(m2);
        qf.approve(id);
        vm.prank(m3);
        vm.expectRevert("already executed");
        qf.approve(id);
    }

    function test_ApproveNonexistentReverts() public {
        vm.prank(m1);
        vm.expectRevert("no proposal");
        qf.approve(999);
    }

    // --- constructor validations ---
    function test_ConstructorReverts() public {
        address[] memory members = new address[](2);
        members[0] = m1;
        members[1] = m2;

        vm.expectRevert("zero rulebook");
        new QuorumFlagger(address(0), members, 2);

        address[] memory none = new address[](0);
        vm.expectRevert("no members");
        new QuorumFlagger(address(rb), none, 1);

        vm.expectRevert("bad threshold");
        new QuorumFlagger(address(rb), members, 0);

        vm.expectRevert("bad threshold");
        new QuorumFlagger(address(rb), members, 3);

        address[] memory dups = new address[](2);
        dups[0] = m1;
        dups[1] = m1;
        vm.expectRevert("duplicate member");
        new QuorumFlagger(address(rb), dups, 2);

        address[] memory zero = new address[](1);
        zero[0] = address(0);
        vm.expectRevert("zero member");
        new QuorumFlagger(address(rb), zero, 1);
    }
}
