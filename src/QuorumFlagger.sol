// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Rulebook.sol";

/// @title QuorumFlagger
/// @notice M-of-N emergency flagger for a Rulebook: a flag executes only after
/// `threshold` distinct members approve. The Rulebook's own guards still apply
/// (tighten-only, rate-limit, maxHalt) — this contract adds the quorum.
/// @dev Both contracts are immutable, so deploy in this order:
///   1. qfAddr = address of (deployer, nextNonce + 1)  [precompute offchain]
///   2. rb = new Rulebook(admin, qfAddr, timelock)
///   3. qf = new QuorumFlagger(address(rb), members, threshold) // lands at qfAddr
/// Members are immutable (no add/remove in v1). Proposals expire after
/// PROPOSAL_EXPIRY so a stale approval can never execute against a changed market.
/// If the Rulebook rejects execution (e.g. rate-limited), the approve reverts
/// and members can retry once the cooldown passes — no bricked proposals.
contract QuorumFlagger {
    Rulebook public immutable rulebook;
    uint256 public immutable threshold;
    /// @notice Proposals die if not executed within this window.
    uint256 public constant PROPOSAL_EXPIRY = 24 hours;

    address[] public members;
    mapping(address => bool) public isMember;

    struct Proposal {
        bytes32 asset;
        Rulebook.ActionClass cls;
        Rulebook.Action action;
        uint64 duration;
        bytes32 reason;
        uint64 createdAt;
        uint256 approvals;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;
    uint256 public proposalCount;

    event Proposed(uint256 indexed id, address indexed proposer, bytes32 asset, Rulebook.ActionClass cls);
    event Approved(uint256 indexed id, address indexed member, uint256 approvals);
    event Executed(uint256 indexed id);

    constructor(address _rulebook, address[] memory _members, uint256 _threshold) {
        require(_rulebook != address(0), "zero rulebook");
        require(_members.length > 0, "no members");
        require(_threshold > 0 && _threshold <= _members.length, "bad threshold");
        rulebook = Rulebook(_rulebook);
        threshold = _threshold;
        for (uint256 i = 0; i < _members.length; i++) {
            require(_members[i] != address(0), "zero member");
            require(!isMember[_members[i]], "duplicate member");
            isMember[_members[i]] = true;
            members.push(_members[i]);
        }
    }

    /// @notice Propose a flag. The proposer counts as the first approval;
    /// with threshold == 1 this executes immediately.
    function proposeFlag(
        bytes32 asset,
        Rulebook.ActionClass cls,
        Rulebook.Action action,
        uint64 duration,
        bytes32 reason
    ) external returns (uint256 id) {
        require(isMember[msg.sender], "not member");
        require(
            action == Rulebook.Action.HALT || action == Rulebook.Action.COLLAR || action == Rulebook.Action.DEFER,
            "tighten-only"
        );
        require(duration > 0 && duration <= rulebook.MAX_HALT(), "bad duration");
        id = proposalCount++;
        proposals[id] = Proposal({
            asset: asset,
            cls: cls,
            action: action,
            duration: duration,
            reason: reason,
            createdAt: uint64(block.timestamp),
            approvals: 1,
            executed: false
        });
        approved[id][msg.sender] = true;
        emit Proposed(id, msg.sender, asset, cls);
        emit Approved(id, msg.sender, 1);
        if (threshold == 1) _execute(id);
    }

    /// @notice Approve a live proposal. Executes once the threshold is met.
    function approve(uint256 id) external {
        require(isMember[msg.sender], "not member");
        require(id < proposalCount, "no proposal");
        Proposal storage p = proposals[id];
        require(!p.executed, "already executed");
        require(block.timestamp <= p.createdAt + PROPOSAL_EXPIRY, "proposal expired");
        require(!approved[id][msg.sender], "already approved");
        approved[id][msg.sender] = true;
        p.approvals++;
        emit Approved(id, msg.sender, p.approvals);
        if (p.approvals >= threshold) _execute(id);
    }

    function _execute(uint256 id) internal {
        Proposal storage p = proposals[id];
        p.executed = true;
        rulebook.flag(p.asset, p.cls, p.action, p.duration, p.reason);
        emit Executed(id);
    }
}
