# Indexer → UI Contract

The poller writes `indexer/state/latest.json` every 60s. The UI reads this file.
No direct RPC calls from the UI.

## `latest.json` shape

```json
{
  "ts": "2026-10-10T08:30:00.000Z",
  "chains": {
    "46630": {
      "chainId": "46630",
      "name": "Robinhood",
      "block": "12345678",
      "clock": { "open": false, "anchor": "EQUITY_US", "at": "1728546600" },
      "rules": {
        "SWAP":      { "action": "COLLAR", "param": "500",  "reason": "STEP0" },
        "BORROW":    { "action": "CAP",    "param": "1000", "reason": "STEP0" },
        "LIQUIDATE": { "action": "DEFER",  "param": "3600", "reason": "STEP0" },
        "SETTLE":    { "action": "COLLAR", "param": "500",  "reason": "STEP0" }
      }
    },
    "998": { "..." },
    "42431": { "..." }
  }
}
```

On chain error: `{ "chainId": "998", "error": "..." }`.

## UI screens → data mapping

| Screen | Data source |
|---|---|
| AHA 3-chain weekend comparison | `~/workspace/trisara-offchain/logs/weekend1-*.jsonl` (historical staleness) + `latest.json` clock states |
| 3-chain live board | `latest.json` → per chain: block, clock.open, rules |
| Plain-English Rulebook view | `latest.json` → rules; translate: COLLAR 500 → "Swaps limited to ±5% bands", CAP 1000 → "Borrowing capped at 10%", DEFER 3600 → "Liquidations deferred up to 1 hour" |
| Trip / transition log | Poller does not yet emit events. Phase 2: `RuleSet`, `FlagRaised` event logs. For now, UI shows rule changes by diffing `state/<chainId>.json` snapshots. |

## Weekend comparison data

Historical rows: one JSON object per line, fields `ts`, `robinhood.{AAPL,TSLA,NVDA}.stalenessSec`, `hyperliquid.ok`.
Location: `~/workspace/trisara-offchain/logs/weekend1-20261009.jsonl` (Fri close)
and `weekend1-20261010.jsonl` (weekend).

## Incident replays (static)

Deterministic traces for the demo: `ui/public/replays/*.json`
- `hims-aug29-31-2026.json` — guarded DEFER, $782.56 unguarded loss
- `jelly-mar2025.json` — zero guarded liquidations
- `usdc-mar2023.json` — PEG_BREAK_CLOSED, $1,300 unguarded loss
- `rh-stall-sep4-2026.json` — CHAIN_DEGRADED, zero liquidations
