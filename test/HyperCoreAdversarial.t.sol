// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/adapters/HyperCoreAdapter.sol";
import "../src/adapters/PoolTwapAdapter.sol";
import "../src/QuorumFlagger.sol";
import "../src/Rulebook.sol";

/// @notice Stub precompile with immutable price (survives vm.etch).
contract MockPrecompile {
    uint256 immutable PX;

    constructor(uint256 _px) {
        PX = _px;
    }

    fallback() external {
        uint256 p = PX;
        assembly {
            mstore(0, p)
            return(0, 32)
        }
    }
}

/// @notice Day-3 HL adversarial suite: empty precompile, TWAP griefing,
/// flagger spam, timelock bypass. Every attack must fail safe.
contract HyperCoreAdversarial is Test {
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;

    function setUp() public {
        vm.warp(1_000_000);
    }

    // ---- 1. empty precompile mid-operation ----

    function testAdv_precompileGoesEmpty() public {
        MockPrecompile m = new MockPrecompile(3000 * 1e8);
        vm.etch(ORACLE_PX, address(m).code);
        HyperCoreAdapter a = new HyperCoreAdapter(0, true, 8);
        assertTrue(a.read().ok); // healthy
        vm.etch(ORACLE_PX, hex""); // precompile disappears (chain issue)
        HyperCoreAdapter.Reading memory r = a.read();
        assertFalse(r.ok); // fail closed, no stale price served
        assertEq(r.price, 0);
    }

    // ---- 2. TWAP griefing: one manipulated block cannot move the window ----

    function testAdv_twapGriefingBounded() public {
        uint256 window = 900;
        PoolTwapAdapter a = new PoolTwapAdapter(window, 300, address(0));
        uint64 t0 = uint64(block.timestamp - window);
        // Honest market at 100 for the whole window except one griefed block.
        a.poke(100 * 1e18, t0);
        a.poke(100 * 1e18, t0 + 890);
        a.poke(1000 * 1e18, t0 + 899); // attacker prints 10x for ~1 block
        a.poke(100 * 1e18, uint64(block.timestamp));
        PoolTwapAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        // Attacker weight is bounded by manipulated seconds / window:
        // (100*899 + 1000*1 + 100*0... ) / 900 <= 100 + (900/900)*100 = tiny move.
        // Exact: acc = 100*890 + 100*9 + 1000*1 + 100*0 -> compute bound:
        // twap <= 100 + (1000-100)*1/900 = 101
        assertLe(r.price, 101 * 1e18 + 1);
        assertGe(r.price, 99 * 1e18);
    }

    function testAdv_twapGriefNeedsSustainedPush() public {
        // Even 10 minutes of 2x manipulation moves a 15-min TWAP < 2x.
        uint256 window = 900;
        PoolTwapAdapter a = new PoolTwapAdapter(window, 1200, address(0));
        uint64 t0 = uint64(block.timestamp - window);
        a.poke(100 * 1e18, t0);
        a.poke(200 * 1e18, t0 + 300); // attacker holds 2x for 600s
        a.poke(200 * 1e18, uint64(block.timestamp));
        PoolTwapAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        // twap = (100*300 + 200*600)/900 = 166.67
        assertEq(r.price, uint256(100 * 300 + 200 * 600) * 1e18 / 900);
        assertLt(r.price, 200 * 1e18); // never reaches the manipulated print
    }

    // ---- 3. flagger spam ----

    function _flagger(uint256 threshold) internal returns (QuorumFlagger, Rulebook) {
        // Both contracts are immutable: precompute the flagger address first.
        uint256 nonce = vm.getNonce(address(this));
        address futureQF = vm.computeCreateAddress(address(this), nonce + 1);
        Rulebook rb = new Rulebook(address(this), futureQF, 1 hours);
        address[] memory members = new address[](3);
        members[0] = address(0xA);
        members[1] = address(0xB);
        members[2] = address(this);
        QuorumFlagger qf = new QuorumFlagger(address(rb), members, threshold);
        assertEq(address(qf), futureQF, "quorum address mismatch");
        return (qf, rb);
    }

    function testAdv_flaggerSpamCannotWiden() public {
        // Attacker is a member and spams proposals trying to LOOSEN (ALLOW).
        (QuorumFlagger qf,) = _flagger(1);
        vm.startPrank(address(0xA));
        for (uint256 i = 0; i < 10; i++) {
            vm.expectRevert("tighten-only");
            qf.proposeFlag(keccak256("HYPE"), Rulebook.ActionClass.BORROW, Rulebook.Action.ALLOW, 3600, bytes32("spam"));
        }
        vm.stopPrank();
        // Spam HALT proposals are allowed (tighten-only) but bounded by duration
        // and cooldown; none execute a loosening.
        assertEq(qf.proposalCount(), 0);
    }

    function testAdv_flaggerSpamNoQuorumNoExecution() public {
        (QuorumFlagger qf, Rulebook rb) = _flagger(3); // needs all 3
        vm.prank(address(0xA));
        uint256 id =
            qf.proposeFlag(keccak256("HYPE"), Rulebook.ActionClass.BORROW, Rulebook.Action.HALT, 3600, bytes32("spam"));
        // Attacker approves from a second account, still short of quorum.
        vm.prank(address(0xB));
        qf.approve(id);
        (uint256 approvals, bool executed) = _prop(qf, id);
        assertEq(approvals, 2);
        assertFalse(executed);
        // No flag landed on the rulebook: default deny (HALT, NO_RULE).
        (Rulebook.Action act,,) = rb.decision(keccak256("HYPE"), Rulebook.ActionClass.BORROW);
        assertEq(uint8(act), uint8(Rulebook.Action.HALT));
    }

    function _prop(QuorumFlagger qf, uint256 id) internal view returns (uint256 approvals, bool executed) {
        (,,,,,, approvals, executed) = qf.proposals(id);
    }

    // ---- 4. timelock bypass ----

    function testAdv_timelockBypassReverts() public {
        // flagger never invoked here; dummy address satisfies the constructor.
        Rulebook rb = new Rulebook(address(this), address(0xFF), 1 hours);
        bytes32 asset = keccak256("HYPE");
        // Tighten first: HALT with expiry.
        rb.setRule(
            asset,
            Rulebook.ActionClass.SWAP,
            Rulebook.Rule({
                action: Rulebook.Action.HALT,
                param: 0,
                expiresAt: uint64(block.timestamp + 3600),
                reasonCode: bytes32("test")
            })
        );
        // Now try to loosen (HALT -> COLLAR with wider band): must queue.
        rb.setRule(
            asset,
            Rulebook.ActionClass.SWAP,
            Rulebook.Rule({action: Rulebook.Action.COLLAR, param: 1000, expiresAt: 0, reasonCode: bytes32("loosen")})
        );
        // Early execution reverts; the loosening is NOT live.
        vm.expectRevert("timelocked");
        rb.executeQueuedRule(asset, Rulebook.ActionClass.SWAP);
        (Rulebook.Action act,,) = rb.decision(asset, Rulebook.ActionClass.SWAP);
        assertEq(uint8(act), uint8(Rulebook.Action.HALT)); // still halted
        // After the timelock it executes.
        vm.warp(block.timestamp + 1 hours);
        rb.executeQueuedRule(asset, Rulebook.ActionClass.SWAP);
        (act,,) = rb.decision(asset, Rulebook.ActionClass.SWAP);
        assertEq(uint8(act), uint8(Rulebook.Action.COLLAR));
    }
}
