// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal Uniswap-v2-style pair surface for spot reads.
interface IV2Pair {
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 ts);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20Dec {
    function decimals() external view returns (uint8);
}

/// @title PoolSpotReader (Robinhood Chain)
/// @notice Chain-specific helper: reads spot price of token0 in terms of
/// token1 from a Uniswap-v2-style pool, normalized to 1e18 WAD. Decimals of
/// both tokens are queried at construction and cached per (chainid, pool).
/// Fail-closed: revert, empty reserves, or bad decimals yield ok=false.
contract PoolSpotReader {
    IV2Pair public immutable pool;
    uint8 public immutable d0;
    uint8 public immutable d1;
    bytes32 public immutable cacheKey;

    constructor(address _pool) {
        require(_pool != address(0), "zero pool");
        pool = IV2Pair(_pool);
        d0 = IERC20Dec(pool.token0()).decimals();
        d1 = IERC20Dec(pool.token1()).decimals();
        require(d0 <= 18 && d1 <= 18, "bad decimals");
        cacheKey = keccak256(abi.encode(block.chainid, _pool));
    }

    /// @notice Spot price of token0 denominated in token1, 1e18 WAD.
    /// @dev Low-level staticcall: short/empty returndata is checked, not decoded blindly.
    function spot() external view returns (uint256 priceWad, bool ok) {
        (bool success, bytes memory ret) =
            address(pool).staticcall(abi.encodeWithSelector(IV2Pair.getReserves.selector));
        if (!success || ret.length < 96) return (0, false);
        (uint112 r0, uint112 r1,) = abi.decode(ret, (uint112, uint112, uint32));
        if (r0 == 0 || r1 == 0) return (0, false);
        // price = (r1/10^d1) / (r0/10^d0), scaled to 1e18
        uint256 p = (uint256(r1) * (10 ** (18 + d0))) / (uint256(r0) * (10 ** d1));
        if (p == 0) return (0, false);
        return (p, true);
    }
}

/// @title PoolTwapAdapter (Robinhood Chain)
/// @notice Own rolling-checkpoint TWAP over a trailing window (default 15 min).
/// A keeper (or PoolSpotReader-driven poker) pushes 1e18-normalized spot
/// observations; read() returns the time-weighted average. This is the R4
/// fallback: it does not depend on the pool carrying TWAP observations.
/// Fail-closed: fewer than two checkpoints, no coverage of the full window,
/// or a latest observation older than maxSpotAge all yield ok=false.
/// A single manipulated block cannot move the TWAP beyond
/// (manipulatedDt / window) of its weight.
contract PoolTwapAdapter {
    struct Reading {
        uint256 price; // TWAP, 1e18
        uint256 observedAt; // newest checkpoint used
        bool ok;
    }

    struct Point {
        uint64 t;
        uint128 price; // 1e18
    }

    uint256 public immutable window;
    uint256 public immutable maxSpotAge;
    address public immutable poker; // address(0) = permissionless pokes

    Point[] public points;

    event Poked(uint64 t, uint128 price);

    constructor(uint256 _window, uint256 _maxSpotAge, address _poker) {
        require(_window > 0 && _maxSpotAge > 0, "bad params");
        window = _window;
        maxSpotAge = _maxSpotAge;
        poker = _poker;
    }

    /// @notice Record a spot observation (1e18-normalized). Rejects zero,
    /// future, and non-monotonic timestamps.
    function poke(uint128 priceWad, uint64 t) external {
        require(poker == address(0) || msg.sender == poker, "not poker");
        require(priceWad > 0, "zero price");
        require(t <= block.timestamp, "future timestamp");
        uint256 n = points.length;
        if (n > 0) require(t > points[n - 1].t, "non-monotonic");
        points.push(Point(t, priceWad));
        // Prune points older than two windows to bound storage.
        uint256 cutoff = block.timestamp > 2 * window ? block.timestamp - 2 * window : 0;
        uint256 keep = 0;
        while (keep < points.length && points[keep].t < cutoff) keep++;
        if (keep > 1) {
            // Keep one point before the cutoff for interpolation.
            for (uint256 i = 0; i + keep - 1 < points.length; i++) {
                points[i] = points[i + keep - 1];
            }
            uint256 drop = keep - 1;
            for (uint256 i = 0; i < drop; i++) {
                points.pop();
            }
        }
        emit Poked(t, priceWad);
    }

    /// @notice TWAP over [now-window, now]. Step-wise (last observation wins
    /// each segment); the start boundary uses the last point at or before it.
    function read() external view returns (Reading memory) {
        uint256 n = points.length;
        if (n < 2) return Reading(0, 0, false);
        uint256 nowT = block.timestamp;
        if (nowT < window) return Reading(0, 0, false);
        uint256 start = nowT - window;
        Point memory newest = points[n - 1];
        if (nowT - newest.t > maxSpotAge) return Reading(0, newest.t, false);
        // Find the last point at or before `start` for the boundary price.
        uint256 i = 0;
        bool covered = false;
        for (uint256 k = 0; k < n; k++) {
            if (points[k].t <= start) {
                i = k;
                covered = true;
            } else {
                break;
            }
        }
        if (!covered) return Reading(0, newest.t, false);
        uint256 acc = 0;
        uint256 segStart = start;
        uint128 segPrice = points[i].price;
        for (uint256 k = i + 1; k < n && points[k].t <= nowT; k++) {
            acc += uint256(segPrice) * (points[k].t - segStart);
            segStart = points[k].t;
            segPrice = points[k].price;
        }
        acc += uint256(segPrice) * (nowT - segStart);
        return Reading(acc / window, newest.t, true);
    }

    function pointCount() external view returns (uint256) {
        return points.length;
    }
}
