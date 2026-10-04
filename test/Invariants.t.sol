// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AnchorClock.sol";
import "../src/PriceIntegrity.sol";
import "../src/Rulebook.sol";
import "../src/GuardedFeed.sol";

/// @notice Minimal feed for the invariant handler.
contract FeedMock is IAggregatorV3 {
    int256 public ans = int256(100 * 1e8);
    uint256 public ts = 1791208800;
    uint80 public rid = 1;

    function setPrice(int256 a, uint256 t) external {
        ans = a;
        ts = t;
        rid++;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "MOCK";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (rid, ans, ts, ts, rid);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (rid, ans, ts, ts, rid);
    }
}

/// @notice Handler driven by the invariant fuzzer: random rule / flag / poke /
/// warp sequences. This contract is admin, flagger and keeper — permissions
/// are unit-tested separately; here we fuzz the *invariants*.
contract CoreHandler is Test {
    AnchorClock public clock;
    PriceIntegrity public pi;
    Rulebook public rb;
    GuardedFeed public gf;
    FeedMock public feed;

    bytes32[] public keys;
    mapping(bytes32 => bool) public seen;

    /// @notice Ghost copy of what the Rulebook *should* hold (INV-3 model).
    struct GhostRule {
        uint8 action;
        uint256 param;
        uint64 expiresAt;
        bytes32 reason;
        bool exists;
    }

    mapping(bytes32 => GhostRule) public ghostActive;
    mapping(bytes32 => GhostRule) public ghostQueued;
    mapping(bytes32 => bool) public ghostPending;

    uint256 public constant START = 1791208800; // Mon 2026-10-05 14:00 UTC

    constructor() {
        vm.warp(START);
        clock = new AnchorClock();
        pi = new PriceIntegrity(
            clock,
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 200, velocityBps: 500, velocityWindow: 300, maxFreshness: 900, reopenGrace: 900
            })
        );
        rb = new Rulebook(address(this), address(this), 24 hours);
        feed = new FeedMock();
        gf = new GuardedFeed(address(feed), address(pi), address(this), 100);
    }

    function getKeys() external view returns (bytes32[] memory) {
        return keys;
    }

    function pendingExists(bytes32 key) external view returns (bool) {
        (,, bool exists) = rb.pending(key);
        return exists;
    }

    function _key(bytes32 asset, Rulebook.ActionClass cls) internal view returns (bytes32) {
        return rb.ruleKey(asset, cls);
    }

    function _track(bytes32 key) internal {
        if (!seen[key]) {
            seen[key] = true;
            keys.push(key);
        }
    }

    /// @notice Random rule publication. EXIT skipped (INV-5 covers it separately).
    function setRule(uint256 assetSeed, uint8 clsSeed, uint8 actionSeed, uint256 paramSeed, uint256 expirySeed)
        external
    {
        bytes32 asset = bytes32(bound(assetSeed, 1, 8));
        Rulebook.ActionClass cls = Rulebook.ActionClass(uint8(bound(uint256(clsSeed), 0, 3)));
        Rulebook.Action action = Rulebook.Action(uint8(bound(uint256(actionSeed), 0, 4)));
        uint256 param = bound(paramSeed, 0, 20000);
        uint64 expiresAt;
        if (action == Rulebook.Action.HALT) {
            expiresAt = uint64(bound(expirySeed, block.timestamp + 1, block.timestamp + rb.MAX_HALT()));
        } else if (expirySeed % 2 == 0) {
            expiresAt = 0;
        } else {
            expiresAt = uint64(bound(expirySeed, block.timestamp + 1, block.timestamp + 30 days));
        }
        bytes32 key = _key(asset, cls);
        _track(key);
        Rulebook.Rule memory r =
            Rulebook.Rule({action: action, param: param, expiresAt: expiresAt, reasonCode: bytes32("FUZZ")});
        try rb.setRule(asset, cls, r) {
            _ghostSet(key, r);
        } catch {}
    }

    function executeQueued(uint256 assetSeed, uint8 clsSeed) external {
        bytes32 asset = bytes32(bound(assetSeed, 1, 8));
        Rulebook.ActionClass cls = Rulebook.ActionClass(uint8(bound(uint256(clsSeed), 0, 3)));
        bytes32 key = _key(asset, cls);
        try rb.executeQueuedRule(asset, cls) {
            ghostActive[key] = ghostQueued[key];
            ghostPending[key] = false;
        } catch {}
    }

    function flag(uint256 assetSeed, uint8 clsSeed, uint8 actionSeed, uint256 durationSeed) external {
        bytes32 asset = bytes32(bound(assetSeed, 1, 8));
        Rulebook.ActionClass cls = Rulebook.ActionClass(uint8(bound(uint256(clsSeed), 0, 3)));
        // Flagger is tighten-only: HALT / COLLAR / DEFER.
        Rulebook.Action action = Rulebook.Action(uint8(bound(uint256(actionSeed), 2, 4)));
        uint64 duration = uint64(bound(durationSeed, 1, rb.MAX_HALT()));
        bytes32 key = _key(asset, cls);
        _track(key);
        try rb.flag(asset, cls, action, duration, bytes32("FUZZ")) {} catch {}
    }

    function poke(uint256 refSeed, uint256 prevSeed) external {
        uint256 refPrice = bound(refSeed, 1e8, 1000 * 1e8);
        uint256 prevPrice = bound(prevSeed, 1e8, 1000 * 1e8);
        feed.setPrice(int256(refPrice), block.timestamp);
        gf.poke(
            GuardedFeed.Observation({
                refPrice: refPrice,
                observedAt: block.timestamp,
                marketStatus: 1,
                haltFlag: false,
                chainDegraded: false,
                prevRefPrice: prevPrice,
                prevObservedAt: block.timestamp - 60
            })
        );
    }

    function warpTime(uint256 dtSeed) external {
        uint256 dt = bound(dtSeed, 0, 3 days);
        vm.warp(block.timestamp + dt);
    }

    // --- ghost model (mirrors Rulebook._isLoosening) ---

    function _ghostSet(bytes32 key, Rulebook.Rule memory r) internal {
        GhostRule storage cur = ghostActive[key];
        if (_isLoosening(cur, uint8(r.action), r.param)) {
            ghostQueued[key] = GhostRule(uint8(r.action), r.param, r.expiresAt, r.reasonCode, true);
            ghostPending[key] = true;
        } else {
            ghostActive[key] = GhostRule(uint8(r.action), r.param, r.expiresAt, r.reasonCode, true);
            ghostPending[key] = false;
        }
    }

    function _isLoosening(GhostRule storage cur, uint8 newAction, uint256 newParam) internal view returns (bool) {
        if (!cur.exists) return false; // first publish is never a loosening
        if (newAction < cur.action) return true;
        if (newAction > cur.action) return false;
        if (newAction == 1 || newAction == 2) return newParam > cur.param; // CAP / COLLAR
        if (newAction == 3) return newParam < cur.param; // DEFER: shorter wait = looser
        return false; // ALLOW->ALLOW, HALT->HALT
    }
}

/// @notice INV-1…7 invariant + fuzz suite. Plan refs: Day 2, "CORE — never cut".
/// Stateful invariants run random handler sequences; stateless fuzz tests hit
/// the properties directly. 10,000 runs configured in foundry.toml.
contract CoreInvariants is Test {
    CoreHandler h;

    uint256 internal constant EPOCH = 1767225600; // 2026-01-01 00:00:00 UTC

    function setUp() public {
        h = new CoreHandler();
        targetContract(address(h));
    }

    // ============ stateful invariants (run after every handler call) ============

    /// @notice INV-1: the core is decision-only — it can never hold ETH.
    function invariant_INV1_NoCustody() public view {
        assertEq(address(h.clock()).balance, 0, "INV-1: clock holds ETH");
        assertEq(address(h.pi()).balance, 0, "INV-1: integrity holds ETH");
        assertEq(address(h.rb()).balance, 0, "INV-1: rulebook holds ETH");
        assertEq(address(h.gf()).balance, 0, "INV-1: feed holds ETH");
    }

    /// @notice INV-2a: an active flag always expires within MAX_HALT.
    function invariant_INV2_FlagsBounded() public view {
        Rulebook rb = h.rb();
        bytes32[] memory keys = h.getKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            (, uint64 expiresAt,, bool exists) = rb.flags(keys[i]);
            if (exists && expiresAt > block.timestamp) {
                assertLe(expiresAt - block.timestamp, rb.MAX_HALT(), "INV-2: flag exceeds maxHalt");
            }
        }
    }

    /// @notice INV-2b: a HALT rule always carries an expiry within MAX_HALT.
    /// expiresAt is fixed at creation and time only moves forward, so the
    /// bound holds for the rule's whole life (even after it expires).
    function invariant_INV2_HaltRulesBounded() public view {
        Rulebook rb = h.rb();
        bytes32[] memory keys = h.getKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            if (rb.ruleExists(keys[i])) {
                (Rulebook.Action action,, uint64 expiresAt,) = rb.rules(keys[i]);
                if (action == Rulebook.Action.HALT) {
                    assertTrue(expiresAt != 0, "INV-2: halt without expiry");
                    assertLe(expiresAt, block.timestamp + rb.MAX_HALT(), "INV-2: halt expiry exceeds maxHalt");
                }
            }
        }
    }

    /// @notice INV-3: the timelock model — onchain rules and queues match the spec.
    /// Tightenings apply instantly, loosenings queue; the ghost model tracks both.
    function invariant_INV3_TimelockModel() public view {
        Rulebook rb = h.rb();
        bytes32[] memory keys = h.getKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            bytes32 key = keys[i];
            (uint8 gAction, uint256 gParam, uint64 gExpires,, bool gExists) = h.ghostActive(key);
            assertEq(rb.ruleExists(key), gExists, "INV-3: rule existence diverged");
            if (gExists) {
                (Rulebook.Action action, uint256 param, uint64 expiresAt,) = rb.rules(key);
                assertEq(uint8(action), gAction, "INV-3: action diverged");
                assertEq(param, gParam, "INV-3: param diverged");
                assertEq(expiresAt, gExpires, "INV-3: expiry diverged");
            }
            assertEq(h.pendingExists(key), h.ghostPending(key), "INV-3: pending diverged");
        }
    }

    // ============ stateless fuzz tests ============

    /// @notice INV-4: fail closed — OPEN is returned only when the clock is open,
    /// the observation is fresh, no flag is set and both prices are sane.
    /// (Seeds are packed to stay under the stack limit.)
    function testFuzz_INV4_FailClosed(
        uint256 refPrice,
        uint256 feedPrice,
        uint256 refAtSeed,
        uint256 flagPack, // low 8 bits: marketStatus; bit 8: haltFlag; bit 9: chainDegraded
        uint256 prevPack, // low 128: prevRefPrice; high 128: prevRefAtSeed
        uint256 warpSeed
    ) public {
        uint256 t = bound(warpSeed, EPOCH - 1 days, EPOCH + 731 days);
        uint256 refAt = bound(refAtSeed, 1, t);
        uint8 marketStatus = uint8(flagPack);
        bool haltFlag = (flagPack >> 8) & 1 == 1;
        bool chainDegraded = (flagPack >> 9) & 1 == 1;
        bool mustNotBeOpen = haltFlag || chainDegraded || refPrice == 0 || feedPrice == 0
            || !h.clock().isOpen(AnchorClock.Anchor.EQUITY_US, t, marketStatus != 2)
            || t - refAt > h.pi().maxFreshness();
        PriceIntegrity.EvalInputs memory x = PriceIntegrity.EvalInputs({
            refPrice: refPrice,
            refAt: refAt,
            feedPrice: feedPrice,
            marketStatus: marketStatus,
            haltFlag: haltFlag,
            chainDegraded: chainDegraded,
            prevRefPrice: uint128(prevPack),
            prevRefAt: bound(uint128(prevPack >> 128), 1, refAt)
        });
        PriceIntegrity.State s = _evalAt(x, t);
        if (mustNotBeOpen) assertTrue(s != PriceIntegrity.State.OPEN, "INV-4: fail-closed violated");
    }

    function _evalAt(PriceIntegrity.EvalInputs memory x, uint256 t) internal returns (PriceIntegrity.State s) {
        vm.warp(t);
        (s,) = h.pi().evaluate(x);
    }

    /// @notice INV-5: exit action classes (repay/cancel/refund/close) can never
    /// be restricted — by admin or by flagger.
    function testFuzz_INV5_ExitsNeverBlocked(bytes32 asset, uint8 actionSeed, uint256 param, uint64 expiry) public {
        Rulebook rb = h.rb();
        Rulebook.Action action = Rulebook.Action(uint8(bound(uint256(actionSeed), 0, 4)));

        vm.prank(address(h)); // admin
        vm.expectRevert("exits always open");
        rb.setRule(
            asset,
            Rulebook.ActionClass.EXIT,
            Rulebook.Rule({action: action, param: param, expiresAt: expiry, reasonCode: bytes32("X")})
        );

        vm.prank(address(h)); // flagger
        vm.expectRevert("exits always open");
        rb.flag(asset, Rulebook.ActionClass.EXIT, Rulebook.Action.HALT, 3600, bytes32("X"));

        (Rulebook.Action a,,) = rb.decision(asset, Rulebook.ActionClass.EXIT);
        assertEq(uint8(a), uint8(Rulebook.Action.ALLOW), "INV-5: exit blocked");
    }

    /// @notice INV-6: evaluations are pure functions of (inputs, timestamp) —
    /// two identically-configured instances always agree, so anyone can replay.
    function testFuzz_INV6_Replayable(
        uint256 refPrice,
        uint256 feedPrice,
        uint256 refAtSeed,
        uint256 flagPack,
        uint256 prevPack,
        uint256 warpSeed
    ) public {
        PriceIntegrity pi2 = new PriceIntegrity(
            h.clock(),
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 200, velocityBps: 500, velocityWindow: 300, maxFreshness: 900, reopenGrace: 900
            })
        );
        uint256 t = bound(warpSeed, EPOCH - 1 days, EPOCH + 731 days);
        uint256 refAt = bound(refAtSeed, 1, t);
        PriceIntegrity.EvalInputs memory x = PriceIntegrity.EvalInputs({
            refPrice: refPrice,
            refAt: refAt,
            feedPrice: feedPrice,
            marketStatus: uint8(flagPack),
            haltFlag: (flagPack >> 8) & 1 == 1,
            chainDegraded: (flagPack >> 9) & 1 == 1,
            prevRefPrice: uint128(prevPack),
            prevRefAt: bound(uint128(prevPack >> 128), 1, refAt)
        });
        vm.warp(t);
        (PriceIntegrity.State s1, bytes32 r1) = h.pi().evaluate(x);
        (PriceIntegrity.State s2, bytes32 r2) = pi2.evaluate(x);
        assertEq(uint8(s1), uint8(s2), "INV-6: instances diverged");
        assertEq(r1, r2, "INV-6: reasons diverged");
    }

    /// @notice INV-2 (creation): flag durations and HALT expiries are bounded
    /// at creation — over-long ones revert.
    function testFuzz_INV2_CreationBounded(uint64 durationSeed, uint64 expirySeed) public {
        Rulebook rb = h.rb();
        bytes32 asset = bytes32("A");

        uint64 badDuration = uint64(bound(uint256(durationSeed), rb.MAX_HALT() + 1, type(uint64).max));
        vm.prank(address(h));
        vm.expectRevert("bad duration");
        rb.flag(asset, Rulebook.ActionClass.SWAP, Rulebook.Action.HALT, badDuration, bytes32("X"));

        vm.prank(address(h));
        vm.expectRevert("halt must expire");
        rb.setRule(
            asset,
            Rulebook.ActionClass.SWAP,
            Rulebook.Rule({action: Rulebook.Action.HALT, param: 0, expiresAt: 0, reasonCode: bytes32("X")})
        );

        uint64 badExpiry = uint64(bound(uint256(expirySeed), block.timestamp + rb.MAX_HALT() + 1, type(uint64).max));
        vm.prank(address(h));
        vm.expectRevert("halt exceeds maxHalt");
        rb.setRule(
            asset,
            Rulebook.ActionClass.SWAP,
            Rulebook.Rule({action: Rulebook.Action.HALT, param: 0, expiresAt: badExpiry, reasonCode: bytes32("X")})
        );
    }

    /// @notice INV-7: the decision space contains no liquidation trigger.
    /// Venue signals can only restrict (Day 4's GuardedLender enforces the rest;
    /// at core level we lock the action space itself).
    function testFuzz_INV7_NoTrigger(bytes32 asset) public view {
        Rulebook rb = h.rb();
        assertEq(uint8(Rulebook.Action.HALT), 4, "INV-7: action space changed");
        (Rulebook.Action a,,) = rb.decision(asset, Rulebook.ActionClass.LIQUIDATE);
        assertTrue(uint8(a) <= 4, "INV-7: unknown action");
    }
}
