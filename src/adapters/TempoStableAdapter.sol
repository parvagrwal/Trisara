// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal Stablecoin-DEX quote surface. The exact Tempo DEX selector
/// set is unconfirmed (S7); this interface is verified against the deployed
/// DEX at integration time and swapped if the native selector differs.
interface IDexQuote {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
}

/// @notice Minimal TIP-403 policy surface.
interface ITip403 {
    function isAuthorized(address account) external view returns (bool);
}

interface ITokenDecimals {
    function decimals() external view returns (uint8);
}

/// @title TempoStableAdapter (Tempo)
/// @notice Chain-specific adapter: prices a stablecoin against its par peg by
/// quoting 1 unit on the Stablecoin DEX, and checks TIP-403 authorization for
/// payer and payee. Price is 1e18 WAD per 1e18 of par.
/// Fail-closed on price: a reverted/empty quote, zero output, or a print
/// outside par ± toleranceBps yields ok=false.
/// Compliance is separate from price: checkCompliance() returns false (HOLD)
/// when either party is unauthorized OR the registry call reverts — a registry
/// outage must never read as "authorized".
contract TempoStableAdapter {
    struct Reading {
        uint256 price; // 1e18 WAD per 1e18 par
        uint256 observedAt;
        bool ok;
    }

    IDexQuote public immutable dex;
    address public immutable token;
    address public immutable target; // par target, e.g. pathUSD
    ITip403 public immutable policy;
    uint8 public immutable tokenDecimals;
    uint8 public immutable targetDecimals;
    /// @notice Max deviation from par that still counts as pegged, in bps.
    uint256 public immutable toleranceBps;
    bytes32 public immutable cacheKey;

    uint256 private constant WAD = 1e18;

    constructor(address _dex, address _token, address _target, address _policy, uint256 _toleranceBps) {
        require(_dex != address(0) && _token != address(0) && _target != address(0), "zero address");
        require(_toleranceBps <= 10_000, "bad tolerance");
        dex = IDexQuote(_dex);
        token = _token;
        target = _target;
        policy = ITip403(_policy);
        uint8 td = ITokenDecimals(_token).decimals();
        uint8 xd = ITokenDecimals(_target).decimals();
        require(td <= 18 && xd <= 18, "bad decimals");
        tokenDecimals = td;
        targetDecimals = xd;
        toleranceBps = _toleranceBps;
        cacheKey = keccak256(abi.encode(block.chainid, _token, _target));
    }

    /// @notice Quote 1 token worth against par. Never reverts on bad data.
    /// @dev Low-level staticcall: short/empty returndata is checked, not decoded blindly.
    function read() external view returns (Reading memory) {
        uint256 amountIn = 10 ** tokenDecimals;
        (bool ok, bytes memory ret) =
            address(dex).staticcall(abi.encodeWithSelector(IDexQuote.quote.selector, token, target, amountIn));
        if (!ok || ret.length < 32) return Reading(0, block.timestamp, false);
        uint256 out = abi.decode(ret, (uint256));
        if (out == 0) return Reading(0, block.timestamp, false);
        uint256 priceWad = (out * WAD) / (10 ** targetDecimals);
        if (priceWad == 0) return Reading(0, block.timestamp, false);
        uint256 lo = (WAD * (10_000 - toleranceBps)) / 10_000;
        uint256 hi = (WAD * (10_000 + toleranceBps)) / 10_000;
        if (priceWad < lo || priceWad > hi) return Reading(0, block.timestamp, false);
        return Reading(priceWad, block.timestamp, true);
    }

    /// @notice True only if the TIP-403 registry authorizes BOTH parties.
    /// A registry revert (or short return) reads as unauthorized (HOLD),
    /// never as authorized.
    function checkCompliance(address payer, address payee) external view returns (bool) {
        if (address(policy) == address(0)) return false;
        return _isAuthorized(payer) && _isAuthorized(payee);
    }

    function _isAuthorized(address a) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            address(policy).staticcall(abi.encodeWithSelector(ITip403.isAuthorized.selector, a));
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (bool));
    }
}
