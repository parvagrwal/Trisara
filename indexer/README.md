# Trisara Indexer

Polls AnchorClock + Rulebook on all 3 testnets every 60s. Serves the latest
snapshot over HTTP. Read-only, no keys.

**Live:** https://trisara-indexer.onrender.com

## Run locally

```bash
cd indexer
npm install
npm run poll        # loop every 60s
```

Or as an HTTP server (what Render runs):

```bash
npx tsx server.ts
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /state` | Full snapshot: all chains, clock state, rules, block, latency |
| `GET /health` | Service status |

## Output shape

```json
{
  "schemaVersion": 2,
  "ts": "2026-10-12T00:00:00.000Z",
  "chains": {
    "46630": {
      "chainId": "46630",
      "name": "Robinhood",
      "healthy": true,
      "polledAt": "2026-10-12T00:00:00.000Z",
      "latencyMs": 2131,
      "block": "133202291",
      "clock": { "open": false, "anchor": "EQUITY_US", "at": "1728546600" },
      "rules": {
        "SWAP": { "action": "COLLAR", "param": "500", "reason": "STEP0" }
      }
    }
  }
}
```

## Production features

- 2 RPC endpoints per chain with automatic failover
- Chains poll in parallel (one slow chain doesn't block others)
- Output validated before write — corrupt snapshots never hit disk
- Atomic writes (tmp + rename) — readers never see half-written files
- Every chain entry has `healthy`, `polledAt`, `latencyMs`

See [RUNBOOK.md](RUNBOOK.md) for deployment details.
