// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title HyperCoreAdapter (HyperEVM)
/// @notice Chain-specific adapter: reads one HyperCore precompile per call —
/// markPx (0x…0806) or oraclePx (0x…0807) — for a fixed asset index, and
/// normalizes to 1e18 WAD. NEVER batched: each read is a single unbatched
/// staticcall (HL-P8: multicall out-of-gas on precompile reads).
/// Fail-closed: a reverted call, an empty or short return, or a zero price
/// all yield ok=false. The precompile carries no timestamp, so observedAt is
/// the read block's timestamp; freshness is enforced by the caller's poll
/// cadence, not by this adapter. HIP-3 index assets are NOT read here (S5
/// fallback): core perps via precompile, HIP-3 drift via the labeled
/// offchain flag path.
contract HyperCoreAdapter {
    struct Reading {
        uint256 price; // 1e18-normalized
        uint256 observedAt; // block.timestamp at read
        bool ok;
    }

    address public constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address public constant ORACLE_PX = 0x0000000000000000000000000000000000000807;

    uint32 public immutable assetIndex;
    address public immutable precompile;
    /// @notice Decimals of the precompile's raw price, verified per asset at
    /// deploy (precompiles expose no decimals()).
    uint8 public immutable priceDecimals;
    bytes32 public immutable cacheKey;

    constructor(uint32 _assetIndex, bool _useOraclePx, uint8 _priceDecimals) {
        require(_priceDecimals <= 18, "bad decimals");
        assetIndex = _assetIndex;
        precompile = _useOraclePx ? ORACLE_PX : MARK_PX;
        priceDecimals = _priceDecimals;
        cacheKey = keccak256(abi.encode(block.chainid, _assetIndex, precompile));
    }

    /// @notice Single unbatched precompile read. Never reverts on bad data.
    function read() external view returns (Reading memory) {
        (bool ok, bytes memory ret) = precompile.staticcall(abi.encode(assetIndex));
        if (!ok || ret.length != 32) return Reading(0, block.timestamp, false);
        uint256 px = abi.decode(ret, (uint256));
        if (px == 0) return Reading(0, block.timestamp, false);
        return Reading(_toWad(px), block.timestamp, true);
    }

    function _toWad(uint256 p) internal view returns (uint256) {
        return p * (10 ** (18 - priceDecimals));
    }
}
