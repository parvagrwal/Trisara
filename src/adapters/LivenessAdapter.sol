// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title LivenessAdapter (Robinhood Chain)
/// @notice Chain-specific adapter: detects sequencer/feed-pipeline stalls from
/// inter-block timestamp gaps. There is no external sequencer-uptime feed on
/// this chain (S2b fallback), so liveness is `block.timestamp`-only: a keeper
/// pokes on every poll, and a gap longer than maxGap (120s) reports CHAIN_DEGRADED.
/// Fail-closed: never poked, or a stale poke, yields live=false.
contract LivenessAdapter {
    /// @notice Max tolerated gap between pokes, in seconds (120 per S2b).
    uint256 public immutable maxGap;

    uint256 public lastSeen;
    bool public hasSeen;

    event Poked(uint256 t);

    constructor(uint256 _maxGap) {
        require(_maxGap > 0, "bad gap");
        maxGap = _maxGap;
    }

    /// @notice Record that the feed pipeline was observed alive at this block.
    function poke() external {
        lastSeen = block.timestamp;
        hasSeen = true;
        emit Poked(block.timestamp);
    }

    /// @notice True while pokes arrive within maxGap.
    function isLive() public view returns (bool) {
        if (!hasSeen) return false;
        return block.timestamp - lastSeen <= maxGap;
    }

    /// @notice Seconds since the last poke (type(uint256).max if never poked).
    function gapSec() external view returns (uint256) {
        if (!hasSeen) return type(uint256).max;
        return block.timestamp - lastSeen;
    }
}
