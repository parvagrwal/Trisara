// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AnchorClock.sol";
import "../src/PriceIntegrity.sol";
import "../src/Rulebook.sol";
import "../src/GuardedFeed.sol";

/// @notice Minimal feed stand-in so the gate can deploy GuardedFeed.
contract MockFeedForGate is IAggregatorV3 {
    function decimals() external pure returns (uint8) { return 8; }
    function description() external pure returns (string memory) { return "MOCK"; }
    function version() external pure returns (uint256) { return 1; }
    function getRoundData(uint80)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, int256(100 * 1e8), block.timestamp, block.timestamp, 1);
    }
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, int256(100 * 1e8), block.timestamp, block.timestamp, 1);
    }
}

/// @notice S6 gate — HyperEVM limits. Two checks, both grounded:
///  - Runtime size < 15KB (16KB absolute ceiling): hygiene + chain limits.
///  - Deploy gas < 3M: HyperEVM's small-block gas limit per the official
///    docs (dual-block architecture) and empirical measurement (teller-protocol,
///    Oct 2026). Anything over would use the documented big-block path
///    (evmUserModify usingBigBlocks, 30M limit) — a planned one-time deploy,
///    not a user transaction.
/// Runs in CI on every push.
contract ContractLimitsTest is Test {
    uint256 internal constant MAX_RUNTIME_BYTES = 15 * 1024;
    uint256 internal constant MAX_DEPLOY_GAS = 3_000_000;

    function _checkSize(address deployed, string memory name) internal view {
        uint256 size = deployed.code.length;
        assertLe(size, MAX_RUNTIME_BYTES, string.concat(name, " exceeds 15KB"));
    }

    function test_CoreContracts_UnderLimits() public {
        uint256 g;

        g = gasleft();
        AnchorClock clock = new AnchorClock();
        _checkSize(address(clock), "AnchorClock");
        assertLe(g - gasleft(), MAX_DEPLOY_GAS, "AnchorClock deploy gas");

        g = gasleft();
        PriceIntegrity pi = new PriceIntegrity(
            clock,
            AnchorClock.Anchor.EQUITY_US,
            PriceIntegrity.AssetConfig({
                deviationBps: 200,
                velocityBps: 500,
                velocityWindow: 300,
                maxFreshness: 900,
                reopenGrace: 900
            })
        );
        _checkSize(address(pi), "PriceIntegrity");
        assertLe(g - gasleft(), MAX_DEPLOY_GAS, "PriceIntegrity deploy gas");

        g = gasleft();
        Rulebook rb = new Rulebook(address(0xA11CE), address(0xF1A66E2), 24 hours);
        _checkSize(address(rb), "Rulebook");
        assertLe(g - gasleft(), MAX_DEPLOY_GAS, "Rulebook deploy gas");

        g = gasleft();
        MockFeedForGate mock = new MockFeedForGate();
        GuardedFeed gf = new GuardedFeed(address(mock), address(pi), address(0xBEEF), 100);
        _checkSize(address(gf), "GuardedFeed");
        assertLe(g - gasleft(), MAX_DEPLOY_GAS, "GuardedFeed deploy gas");
    }
}
