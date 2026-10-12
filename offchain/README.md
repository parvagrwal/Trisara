# Offchain Services

Read-only. No transactions, no gas, no keys.

## Signal API (`signal-api.py`)

Session-aware price signals for AAPL, TSLA, NVDA across all 3 testnets.

```bash
python offchain/signal-api.py --port 8080
```

**Live:** https://trisara-signal-api.onrender.com

Endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /signal` | All signals (all chains × all feeds) |
| `GET /signal/{chain_id}/{SYMBOL}` | e.g. `/signal/46630/AAPL` |
| `GET /signal/{SYMBOL}` | Defaults to Robinhood Chain (46630) |
| `GET /health` | Service status |

**Logic:** session is checked first, staleness second.
- CLOSED + stale → COLLAR (staleness is normal on weekends)
- OPEN + stale ≥15min → HALT (real fault, fail closed)
- Feed error → HALT

Each signal reads the chain's onchain `AnchorClock` and `Rulebook`. Falls back to
pilot NYSE-hours logic if RPC fails (labelled `pilot-fallback`).

## Weekend Loggers

Historical price capture scripts. See git history for weekend-1 (Oct 3–5) and
weekend-2 (Oct 10–12) capture windows.

### Weekend-1 Logger (`weekend1-logger.py`)

Read-only price watcher for the Oct 3–5 weekend.

```bash
cd ~/Trisara
python offchain/weekend1-logger.py
```

Output: `offchain/logs/weekend1-YYYYMMDD.jsonl` — one JSON object per line, every 60s.

Feed decimals hardcoded to 8 (verified via `decimals()` on all three feeds, 2026-10-03).
