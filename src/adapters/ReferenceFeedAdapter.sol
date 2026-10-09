// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal Chainlink AggregatorV3 surface used by the adapter.
interface IChainlinkFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ReferenceFeedAdapter (Robinhood Chain)
/// @notice Chain-specific adapter: wraps a Chainlink AggregatorV3 equity
/// reference feed into Trisara's normalized Reading (price in 1e18 WAD).
/// Fail-closed: an upstream revert, empty return, non-positive answer, or a
/// print older than maxFreshness all yield ok=false. Feed decimals are queried
/// once at construction and cached per (chainid, feed).
contract ReferenceFeedAdapter {
    struct Reading {
        uint256 price; // 1e18-normalized
        uint256 observedAt; // feed's updatedAt
        bool ok;
    }

    IChainlinkFeed public immutable feed;
    uint256 public immutable maxFreshness;
    uint8 public immutable feedDecimals;
    /// @notice keccak256(block.chainid, feed): proves which chain+feed this
    /// adapter was calibrated for.
    bytes32 public immutable cacheKey;

    constructor(address _feed, uint256 _maxFreshness) {
        require(_feed != address(0), "zero feed");
        require(_maxFreshness > 0, "bad freshness");
        feed = IChainlinkFeed(_feed);
        maxFreshness = _maxFreshness;
        uint8 d = feed.decimals();
        require(d > 0 && d <= 18, "bad decimals");
        feedDecimals = d;
        cacheKey = keccak256(abi.encode(block.chainid, _feed));
    }

    /// @notice Read the feed. Never reverts on bad data; returns ok=false.
    /// @dev Low-level staticcall (not try/catch): Solidity's try/catch does
    /// not trap ABI-decoding of short/empty returndata, so length is checked
    /// explicitly before decoding.
    function read() external view returns (Reading memory r) {
        (bool ok, bytes memory ret) =
            address(feed).staticcall(abi.encodeWithSelector(IChainlinkFeed.latestRoundData.selector));
        if (!ok || ret.length < 160) return Reading(0, 0, false);
        (, int256 ans,, uint256 upd,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (ans <= 0) return Reading(0, upd, false);
        if (upd == 0 || upd > block.timestamp) return Reading(0, upd, false);
        if (block.timestamp - upd > maxFreshness) return Reading(0, upd, false);
        return Reading(_toWad(uint256(ans)), upd, true);
    }

    function _toWad(uint256 a) internal view returns (uint256) {
        return a * (10 ** (18 - feedDecimals));
    }
}
