// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";

/// @notice Shared helpers for Day-5 incident replays: JSON trace export.
abstract contract ReplayBase is Test {
    function _trace(string memory name, string memory json) internal {
        vm.writeFile(string.concat("ui/public/replays/", name, ".json"), json);
    }

    /// @notice Format 18-decimal USD as "1234.56".
    function _usd(uint256 v) internal view returns (string memory) {
        uint256 dollars = v / 1e18;
        uint256 cents = (v % 1e18) / 1e16;
        string memory cs = cents < 10 ? string.concat("0", vm.toString(cents)) : vm.toString(cents);
        return string.concat(vm.toString(dollars), ".", cs);
    }
}
