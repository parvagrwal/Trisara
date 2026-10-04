// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Rulebook
/// @notice A venue's pre-committed, bounded, auto-expiring rulebook.
/// @dev One instance per venue (venue is implicit): immutable admin + flagger,
/// no registry, no admin-of-admins. Tightening applies instantly; loosening
/// waits out the timelock (INV-3). Every halt and every flag expires (INV-2).
/// Exit action classes (repay/cancel/refund/close) can never be restricted (INV-5).
/// With no published rule, decisions fail closed to HALT (the venue must
/// publish its weekend rule *before* the weekend — that pre-commitment is the product).
contract Rulebook {
    enum Action { ALLOW, CAP, COLLAR, DEFER, HALT }
    enum ActionClass { SWAP, BORROW, LIQUIDATE, SETTLE, EXIT }

    /// @notice Flags and HALT rules auto-expire within this bound (starting parameter).
    uint256 public constant MAX_HALT = 6 hours;
    /// @notice Minimum spacing between two flags on the same key (starting parameter).
    uint256 public constant FLAG_COOLDOWN = 1 hours;

    struct Rule {
        Action action;
        uint256 param; // CAP: max bps | COLLAR: band bps | DEFER: max wait seconds
        uint64 expiresAt; // 0 = persistent (HALT must always expire — INV-2)
        bytes32 reasonCode;
    }

    struct PendingRule {
        Rule rule;
        uint64 eta;
        bool exists;
    }

    struct Flag {
        Action action;
        uint64 expiresAt;
        bytes32 reason;
        bool exists;
    }

    address public immutable venueAdmin;
    address public immutable flagger;
    uint256 public immutable timelockDelay;

    mapping(bytes32 => Rule) public rules;
    mapping(bytes32 => bool) public ruleExists;
    mapping(bytes32 => PendingRule) public pending;
    mapping(bytes32 => Flag) public flags;
    mapping(bytes32 => uint256) public lastFlagAt;

    event RuleSet(bytes32 indexed asset, ActionClass indexed cls, Action action, bytes32 reasonCode);
    event RuleQueued(bytes32 indexed asset, ActionClass indexed cls, uint64 eta);
    event RuleExecuted(bytes32 indexed asset, ActionClass indexed cls);
    event QueuedCancelled(bytes32 indexed asset, ActionClass indexed cls);
    event FlagRaised(
        bytes32 indexed asset, ActionClass indexed cls, Action action, uint64 expiresAt, bytes32 reason
    );

    constructor(address _venueAdmin, address _flagger, uint256 _timelockDelay) {
        require(_venueAdmin != address(0) && _flagger != address(0), "zero address");
        require(_timelockDelay > 0, "zero timelock");
        venueAdmin = _venueAdmin;
        flagger = _flagger;
        timelockDelay = _timelockDelay;
    }

    /// @notice Canonical key for (asset, action class). Venue is this instance.
    function ruleKey(bytes32 asset, ActionClass cls) public pure returns (bytes32) {
        return keccak256(abi.encode(asset, cls));
    }

    /// @notice Publish or update a rule. Tightenings apply instantly and cancel
    /// any queued loosening; loosenings wait out the timelock (INV-3).
    function setRule(bytes32 asset, ActionClass cls, Rule calldata r) external {
        require(msg.sender == venueAdmin, "not admin");
        require(!_isExitClass(cls), "exits always open"); // INV-5
        if (r.action == Action.HALT) {
            require(r.expiresAt != 0, "halt must expire"); // INV-2
            require(r.expiresAt <= block.timestamp + MAX_HALT, "halt exceeds maxHalt");
        }
        bytes32 key = ruleKey(asset, cls);
        if (_isLoosening(key, r)) {
            uint64 eta = uint64(block.timestamp + timelockDelay);
            pending[key] = PendingRule({rule: r, eta: eta, exists: true});
            emit RuleQueued(asset, cls, eta);
        } else {
            rules[key] = r;
            ruleExists[key] = true;
            if (pending[key].exists) {
                delete pending[key];
                emit QueuedCancelled(asset, cls);
            }
            emit RuleSet(asset, cls, r.action, r.reasonCode);
        }
    }

    /// @notice Execute a queued (timelocked) rule after its eta. Permissionless.
    function executeQueuedRule(bytes32 asset, ActionClass cls) external {
        bytes32 key = ruleKey(asset, cls);
        PendingRule storage p = pending[key];
        require(p.exists, "no queued rule");
        require(block.timestamp >= p.eta, "timelocked");
        rules[key] = p.rule;
        ruleExists[key] = true;
        delete pending[key];
        emit RuleExecuted(asset, cls);
    }

    /// @notice Venue admin can cancel a queued loosening explicitly.
    function cancelQueuedRule(bytes32 asset, ActionClass cls) external {
        require(msg.sender == venueAdmin, "not admin");
        bytes32 key = ruleKey(asset, cls);
        require(pending[key].exists, "no queued rule");
        delete pending[key];
        emit QueuedCancelled(asset, cls);
    }

    /// @notice Emergency tighten-only flag. Can never loosen the current rule,
    /// always expires within MAX_HALT, and is rate-limited per key.
    function flag(bytes32 asset, ActionClass cls, Action action, uint64 durationSecs, bytes32 reason)
        external
    {
        require(msg.sender == flagger, "not flagger");
        require(!_isExitClass(cls), "exits always open"); // INV-5
        require(
            action == Action.HALT || action == Action.COLLAR || action == Action.DEFER,
            "tighten-only actions"
        );
        require(durationSecs > 0 && durationSecs <= MAX_HALT, "bad duration");
        bytes32 key = ruleKey(asset, cls);
        require(
            lastFlagAt[key] == 0 || block.timestamp >= lastFlagAt[key] + FLAG_COOLDOWN,
            "rate-limited"
        );
        require(_rank(action) >= _currentRank(key), "flag would loosen");

        uint64 expiresAt = uint64(block.timestamp) + durationSecs;
        flags[key] = Flag({action: action, expiresAt: expiresAt, reason: reason, exists: true});
        lastFlagAt[key] = block.timestamp;
        emit FlagRaised(asset, cls, action, expiresAt, reason);
    }

    /// @notice The effective decision for (asset, action class) right now.
    function decision(bytes32 asset, ActionClass cls)
        external
        view
        returns (Action action, uint256 param, bytes32 reason)
    {
        if (_isExitClass(cls)) return (Action.ALLOW, 0, bytes32("EXIT_ALWAYS_OPEN")); // INV-5
        bytes32 key = ruleKey(asset, cls);
        Flag storage f = flags[key];
        if (f.exists && block.timestamp < f.expiresAt) {
            return (f.action, 0, f.reason);
        }
        if (!ruleExists[key]) return (Action.HALT, 0, bytes32("NO_RULE")); // default deny
        Rule storage r = rules[key];
        if (r.expiresAt != 0 && block.timestamp >= r.expiresAt) {
            return (Action.HALT, 0, bytes32("RULE_EXPIRED"));
        }
        return (r.action, r.param, r.reasonCode);
    }

    // --- internals ---

    function _isExitClass(ActionClass cls) internal pure returns (bool) {
        return cls == ActionClass.EXIT;
    }

    /// @notice Strictness ranking: ALLOW < CAP < COLLAR < DEFER < HALT.
    function _rank(Action a) internal pure returns (uint8) {
        if (a == Action.ALLOW) return 0;
        if (a == Action.CAP) return 1;
        if (a == Action.COLLAR) return 2;
        if (a == Action.DEFER) return 3;
        return 4; // HALT
    }

    /// @notice True iff moving from the current rule to `nxt` loosens it.
    /// Same-rank param moves use per-action direction; ambiguity fails
    /// toward the timelock (when in doubt, delay).
    function _isLoosening(bytes32 key, Rule calldata nxt) internal view returns (bool) {
        if (!ruleExists[key]) return false; // first publish is never a loosening
        Rule storage cur = rules[key];
        uint8 curRank = _rank(cur.action);
        uint8 nxtRank = _rank(nxt.action);
        if (nxtRank < curRank) return true;
        if (nxtRank > curRank) return false;
        if (nxt.action == Action.CAP || nxt.action == Action.COLLAR) {
            return nxt.param > cur.param; // wider cap/collar = looser
        }
        if (nxt.action == Action.DEFER) {
            return nxt.param < cur.param; // shorter wait = looser
        }
        return false; // ALLOW->ALLOW, HALT->HALT: not a loosening
    }

    /// @notice Strictness of whatever is currently effective (for the flagger's
    /// tighten-only check). Missing/expired rules count as HALT (default deny).
    function _currentRank(bytes32 key) internal view returns (uint8) {
        Flag storage f = flags[key];
        if (f.exists && block.timestamp < f.expiresAt) return _rank(f.action);
        if (!ruleExists[key]) return _rank(Action.HALT);
        Rule storage r = rules[key];
        if (r.expiresAt != 0 && block.timestamp >= r.expiresAt) return _rank(Action.HALT);
        return _rank(r.action);
    }
}
