# Trisara Architecture — Onchain Call Paths

## Session enforcement (what the routers actually do)

```
GuardedSwapRouter ──→ GuardedFeed ──→ PriceIntegrity ──→ AnchorClock
GuardedLender    ──→ GuardedFeed ──→ PriceIntegrity ──→ AnchorClock
GuardedSettlementRouter ──→ GuardedFeed ──→ PriceIntegrity ──→ AnchorClock
```

The guarded routers do **not** call the Rulebook on-chain. They get session
awareness through `GuardedFeed`, which runs every price through `PriceIntegrity`,
which checks the `AnchorClock` for the current session state (OPEN/CLOSED).

- Market OPEN → prices pass through normally
- Market CLOSED → `GuardedFeed` applies collar/defer logic per its configuration
- Feed stale or halted → routers refund or revert (fail closed)

## Rulebook (standalone venue contract)

```
Venue contract ──→ Rulebook.decision(asset, actionClass)
                        → (action, param, reason)
```

The `Rulebook` is a separate on-chain contract that any venue can query for
session-aware trading rules. It is **not** in the guarded routers' call path.
Venues building custom logic call `Rulebook.decision()` directly to get the
current action (ALLOW/CAP/COLLAR/DEFER/HALT) for an asset and action class.

The offchain signal API reads both the `AnchorClock` and `Rulebook` to produce
human-readable signals, but this is off-chain convenience — not consensus.

## Summary

| Contract | Called by routers? | Purpose |
|----------|-------------------|---------|
| AnchorClock | Indirectly (via GuardedFeed → PriceIntegrity) | Session state (OPEN/CLOSED) |
| PriceIntegrity | Indirectly (via GuardedFeed) | Price validation against session |
| GuardedFeed | Yes, directly | Session-aware price feed |
| Rulebook | No | Standalone rules for venues building custom logic |
| QuorumFlagger | No | Governance: quorum-based emergency flags |
