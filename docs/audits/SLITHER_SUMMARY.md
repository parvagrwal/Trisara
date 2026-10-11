# Slither Audit — 2026-10-12

Automated static analysis via Slither 0.11.6 (102 detectors, 35 contracts).

| Severity | Count |
|----------|-------|
| Informational (High confidence) | 11 |
| Informational (Medium confidence) | 1 |
| Low (Medium confidence) | 23 |
| Medium (High confidence) | 2 |
| Medium (Medium confidence) | 14 |

## Notable findings

2 Medium/High-confidence findings, both assessed as false positives:

- `GuardedLender.pokeSession()`: `closedSince == 0` checks uninitialized state. Intentional pattern.
- `GuardedLender.liquidate()`: `reopenedAt == 0` checks uninitialized state. Intentional pattern.

**Result: 0 high-severity issues. 0 actionable medium issues.**

Full machine-readable report: `slither-2026-10-12.json`.

Note: automated scan only. Formal audit required before mainnet.