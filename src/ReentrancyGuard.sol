// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal SSTORE-based reentrancy guard (EVM Paris has no transient
/// storage, so ReentrancyGuardTransient is unavailable). Mirrors the core of
/// OpenZeppelin's ReentrancyGuard.
abstract contract ReentrancyGuard {
    uint256 private _status;

    constructor() {
        _status = 1;
    }

    modifier nonReentrant() {
        require(_status == 1, "reentrant");
        _status = 2;
        _;
        _status = 1;
    }
}
