// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/adapters/ReferenceFeedAdapter.sol";
import "../../src/adapters/PoolTwapAdapter.sol";
import "../../src/adapters/LivenessAdapter.sol";
import "../../src/adapters/HyperCoreAdapter.sol";
import "../../src/adapters/TempoStableAdapter.sol";

// ---------------------------------------------------------------- mocks

/// @notice Controllable Chainlink feed. Modes: 0=normal, 1=revert, 2=empty return.
contract MockChainlink {
    uint8 public dec;
    int256 public ans;
    uint256 public upd;
    uint8 public mode;

    constructor(uint8 _dec) {
        dec = _dec;
    }

    function set(int256 a, uint256 t, uint8 m) external {
        ans = a;
        upd = t;
        mode = m;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(mode != 1, "mock revert");
        if (mode == 2) {
            assembly {
                return(0, 0)
            }
        }
        return (1, ans, upd, upd, 1);
    }
}

contract MockV2Pair {
    uint112 public r0;
    uint112 public r1;
    uint8 public d0;
    address public t1;

    function set(uint112 _r0, uint112 _r1, uint8 _d0, address _t1) external {
        r0 = _r0;
        r1 = _r1;
        d0 = _d0;
        t1 = _t1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        require(!shouldRevert, "mock revert");
        return (r0, r1, 0);
    }

    bool public shouldRevert;

    function token0() external view returns (address) {
        return address(this);
    }

    function token1() external view returns (address) {
        return t1;
    }
}

// token0() == address(this): decimals() here serves the reader's d0 query.
contract MockV2PairDec is MockV2Pair {
    function decimals() external view returns (uint8) {
        return d0;
    }
}

contract MockDex {
    uint256 public out;
    uint8 public mode; // 0=normal, 1=revert

    function set(uint256 _out, uint8 _mode) external {
        out = _out;
        mode = _mode;
    }

    function quote(address, address, uint256) external view returns (uint256) {
        require(mode != 1, "mock revert");
        return out;
    }
}

contract MockTip403 {
    mapping(address => bool) public auth;
    bool public shouldRevert;

    function setAuth(address a, bool v) external {
        auth[a] = v;
    }

    function setRevert(bool v) external {
        shouldRevert = v;
    }

    function isAuthorized(address a) external view returns (bool) {
        require(!shouldRevert, "mock revert");
        return auth[a];
    }
}

contract MockERC20Dec {
    uint8 public dec;

    constructor(uint8 _dec) {
        dec = _dec;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }
}

// ---------------------------------------------------------------- suite

/// @notice Adapter conformance: decimals hygiene, normalization, staleness,
/// empty/revert/zero fail-closed — per adapter, per the Day-3 plan.
contract AdapterConformance is Test {
    uint256 constant FRESH = 300;

    function setUp() public {
        vm.warp(1_000_000); // avoid timestamp underflow in staleness math
    }

    // ---- ReferenceFeedAdapter ----

    function testRef_decimalsCachedPerChainFeed() public {
        MockChainlink f = new MockChainlink(8);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        assertEq(a.feedDecimals(), 8);
        assertEq(a.cacheKey(), keccak256(abi.encode(block.chainid, address(f))));
    }

    function testRef_normalizesToWad() public {
        MockChainlink f = new MockChainlink(6);
        f.set(int256(100 * 1e6), block.timestamp, 0);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        ReferenceFeedAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        assertEq(r.price, 100 * 1e18);
    }

    function testRef_staleFailsClosed() public {
        MockChainlink f = new MockChainlink(8);
        f.set(int256(100 * 1e8), block.timestamp - FRESH - 1, 0);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        assertFalse(a.read().ok);
    }

    function testRef_revertFailsClosed() public {
        MockChainlink f = new MockChainlink(8);
        f.set(0, 0, 1);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        assertFalse(a.read().ok);
    }

    function testRef_emptyFailsClosed() public {
        MockChainlink f = new MockChainlink(8);
        f.set(0, 0, 2);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        assertFalse(a.read().ok);
    }

    function testRef_zeroPriceFailsClosed() public {
        MockChainlink f = new MockChainlink(8);
        f.set(0, block.timestamp, 0);
        ReferenceFeedAdapter a = new ReferenceFeedAdapter(address(f), FRESH);
        assertFalse(a.read().ok);
    }

    function testRef_badDecimalsRejected() public {
        MockChainlink f = new MockChainlink(19);
        vm.expectRevert("bad decimals");
        new ReferenceFeedAdapter(address(f), FRESH);
    }

    // ---- PoolTwapAdapter ----

    function _twap() internal returns (PoolTwapAdapter) {
        return new PoolTwapAdapter(900, 300, address(0));
    }

    function testTwap_math() public {
        PoolTwapAdapter a = _twap();
        uint64 t0 = uint64(block.timestamp - 900);
        a.poke(100 * 1e18, t0);
        a.poke(200 * 1e18, t0 + 450);
        a.poke(200 * 1e18, uint64(block.timestamp));
        // 100 for 450s, 200 for 450s -> 150
        PoolTwapAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        assertEq(r.price, 150 * 1e18);
    }

    function testTwap_noCoverageFailsClosed() public {
        PoolTwapAdapter a = _twap();
        a.poke(100 * 1e18, uint64(block.timestamp - 100));
        a.poke(100 * 1e18, uint64(block.timestamp));
        assertFalse(a.read().ok); // window not covered
    }

    function testTwap_singlePointFailsClosed() public {
        PoolTwapAdapter a = _twap();
        a.poke(100 * 1e18, uint64(block.timestamp));
        assertFalse(a.read().ok);
    }

    function testTwap_staleSpotFailsClosed() public {
        PoolTwapAdapter a = _twap();
        uint64 t0 = uint64(block.timestamp - 900);
        a.poke(100 * 1e18, t0);
        a.poke(100 * 1e18, t0 + 450);
        vm.warp(block.timestamp + 301); // newest point now older than maxSpotAge
        assertFalse(a.read().ok);
    }

    function testTwap_zeroPriceRejected() public {
        PoolTwapAdapter a = _twap();
        vm.expectRevert("zero price");
        a.poke(0, uint64(block.timestamp));
    }

    function testTwap_nonMonotonicRejected() public {
        PoolTwapAdapter a = _twap();
        a.poke(100 * 1e18, uint64(block.timestamp));
        vm.expectRevert("non-monotonic");
        a.poke(100 * 1e18, uint64(block.timestamp));
    }

    function testSpotReader_decimalsAndMath() public {
        MockV2PairDec p = new MockV2PairDec();
        MockERC20Dec t1 = new MockERC20Dec(18);
        // token0: 6 dec, token1: 18 dec; 1 token0 = 2 token1
        p.set(uint112(100 * 1e6), uint112(200 * 1e18), 6, address(t1));
        PoolSpotReader r = new PoolSpotReader(address(p));
        (uint256 px, bool ok) = r.spot();
        assertTrue(ok);
        assertEq(px, 2 * 1e18);
        assertEq(r.cacheKey(), keccak256(abi.encode(block.chainid, address(p))));
    }

    function testSpotReader_emptyReservesFailsClosed() public {
        MockV2PairDec p = new MockV2PairDec();
        MockERC20Dec t1 = new MockERC20Dec(18);
        p.set(0, 0, 6, address(t1));
        PoolSpotReader r = new PoolSpotReader(address(p));
        (, bool ok) = r.spot();
        assertFalse(ok);
    }

    // ---- LivenessAdapter ----

    function testLive_startsDead() public {
        LivenessAdapter a = new LivenessAdapter(120);
        assertFalse(a.isLive());
        assertEq(a.gapSec(), type(uint256).max);
    }

    function testLive_gapBoundary() public {
        LivenessAdapter a = new LivenessAdapter(120);
        a.poke();
        assertTrue(a.isLive());
        vm.warp(block.timestamp + 120);
        assertTrue(a.isLive()); // boundary inclusive
        vm.warp(block.timestamp + 1);
        assertFalse(a.isLive()); // 121s gap = CHAIN_DEGRADED
    }

    // ---- HyperCoreAdapter ----

    address constant PRE = 0x0000000000000000000000000000000000000807;

    function _etchPrecompile(bytes memory code) internal {
        vm.etch(PRE, code);
    }

    function testHc_okAndNormalized() public {
        MockPrecompile m = new MockPrecompile(2500 * 1e8);
        vm.etch(PRE, address(m).code);
        HyperCoreAdapter a = new HyperCoreAdapter(1, true, 8);
        HyperCoreAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        assertEq(r.price, 2500 * 1e18);
        assertEq(a.cacheKey(), keccak256(abi.encode(block.chainid, uint32(1), PRE)));
    }

    function testHc_emptyFailsClosed() public {
        vm.etch(PRE, hex"");
        HyperCoreAdapter a = new HyperCoreAdapter(1, true, 8);
        assertFalse(a.read().ok);
    }

    function testHc_zeroFailsClosed() public {
        MockPrecompile m = new MockPrecompile(0);
        vm.etch(PRE, address(m).code);
        HyperCoreAdapter a = new HyperCoreAdapter(1, true, 8);
        assertFalse(a.read().ok);
    }

    function testHc_revertFailsClosed() public {
        MockPrecompileRevert m = new MockPrecompileRevert();
        vm.etch(PRE, address(m).code);
        HyperCoreAdapter a = new HyperCoreAdapter(1, true, 8);
        assertFalse(a.read().ok);
    }

    // ---- TempoStableAdapter ----

    function _tempo(uint256 quoteOut, uint256 tol) internal returns (TempoStableAdapter, MockDex) {
        MockDex dex = new MockDex();
        dex.set(quoteOut, 0);
        MockERC20Dec tok = new MockERC20Dec(6);
        MockERC20Dec tgt = new MockERC20Dec(6);
        MockTip403 pol = new MockTip403();
        TempoStableAdapter a = new TempoStableAdapter(address(dex), address(tok), address(tgt), address(pol), tol);
        return (a, dex);
    }

    function testTempo_pegOk() public {
        (TempoStableAdapter a,) = _tempo(1 * 1e6, 50);
        TempoStableAdapter.Reading memory r = a.read();
        assertTrue(r.ok);
        assertEq(r.price, 1 * 1e18);
    }

    function testTempo_depegFailsClosed() public {
        (TempoStableAdapter a,) = _tempo(0.94 * 1e6, 50); // -6% vs 0.5% tolerance
        assertFalse(a.read().ok);
    }

    function testTempo_revertFailsClosed() public {
        (TempoStableAdapter a, MockDex dex) = _tempo(1 * 1e6, 50);
        dex.set(0, 1);
        assertFalse(a.read().ok);
    }

    function testTempo_zeroFailsClosed() public {
        (TempoStableAdapter a,) = _tempo(0, 50);
        assertFalse(a.read().ok);
    }

    function testTempo_compliance() public {
        MockDex dex = new MockDex();
        dex.set(1 * 1e6, 0);
        MockERC20Dec tok = new MockERC20Dec(6);
        MockERC20Dec tgt = new MockERC20Dec(6);
        MockTip403 pol = new MockTip403();
        TempoStableAdapter a = new TempoStableAdapter(address(dex), address(tok), address(tgt), address(pol), 50);
        address payer = address(0x1111);
        address payee = address(0x2222);
        pol.setAuth(payer, true);
        pol.setAuth(payee, true);
        assertTrue(a.checkCompliance(payer, payee));
        pol.setAuth(payee, false);
        assertFalse(a.checkCompliance(payer, payee)); // HOLD
        pol.setRevert(true);
        assertFalse(a.checkCompliance(payer, payee)); // registry down reads as HOLD
    }
}

/// @notice Stub precompile: returns abi.encode(price) on any staticcall.
/// Price is immutable so it survives vm.etch (etched code has zero storage).
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

contract MockPrecompileRevert {
    fallback() external {
        revert("nope");
    }
}
