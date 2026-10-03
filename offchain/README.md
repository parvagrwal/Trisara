# Weekend-1 Logger

Read-only price watcher for the Oct 3–5 weekend. No transactions, no gas, no keys.

## Run

```bash
cd ~/Trisara
python offchain/weekend1-logger.py
```

Leave it running. Stop with Ctrl+C. To run in the background (Git Bash):

```bash
nohup python offchain/weekend1-logger.py > offchain/logs/logger.out 2>&1 &
```

## Output

`offchain/logs/weekend1-YYYYMMDD.jsonl` — one JSON object per line, every 60s:

```json
{
  "ts": "2026-10-03T10:00:00+00:00",
  "robinhood": {
    "AAPL": {"ok": true, "price": 335.4773, "updatedAt": 1790959180, "stalenessSec": 61200, ...},
    "TSLA": {...},
    "NVDA": {...}
  },
  "hyperliquid": {"ok": true, "mids": {"BTC": "97012.5", ...}}
}
```

## What to look for Monday

- `stalenessSec` growing all weekend on the Chainlink feeds = the thesis, measured.
- Any Monday-reopen jump between the stale feed price and live pool/perp prices.
- This file feeds the incident replay harness and the final report.

## Notes

- Feed decimals hardcoded to 8 (verified via `decimals()` on all three feeds, 2026-10-03). Raw values also logged.
- RPC failover: add a secondary Robinhood RPC to `RH_RPCS` in the script when available.
