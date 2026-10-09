// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Testnet-only TIP-403 policy that authorizes everyone.
/// NEVER mainnet — production uses the real policy contract.
contract AllowAllPolicy {
    function isAuthorized(address) external pure returns (bool) {
        return true;
    }
}
