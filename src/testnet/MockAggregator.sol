// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Chainlink-compatible mock feed for testnets (Chainlink stock
/// feeds are mainnet-only). Owner can update the price. NEVER mainnet.
contract MockAggregator {
    uint8 public immutable decimals;
    address public owner;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    event PriceUpdated(int256 price, uint256 updatedAt);

    constructor(uint8 _decimals, int256 _initialPrice) {
        decimals = _decimals;
        owner = msg.sender;
        answer = _initialPrice;
        updatedAt = block.timestamp;
        roundId = 1;
    }

    function setPrice(int256 p) external {
        require(msg.sender == owner, "not owner");
        answer = p;
        updatedAt = block.timestamp;
        roundId += 1;
        emit PriceUpdated(p, block.timestamp);
    }

    function transferOwnership(address n) external {
        require(msg.sender == owner, "not owner");
        owner = n;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, block.timestamp, updatedAt, roundId);
    }
}
