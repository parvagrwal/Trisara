# Deployed Services

Live production endpoints for the Trisara backend. Both are read-only, no keys.

## Indexer

- **URL:** https://trisara-indexer.onrender.com
- **Source:** `indexer/server.ts` (wraps `indexer/poller.ts`)
- **Endpoints:**
  - `GET /state` — full chain snapshot (all 3 testnets)
  - `GET /health` — service status

Polls AnchorClock + Rulebook on all 3 chains every 60s.

## Signal API

- **URL:** https://trisara-signal-api.onrender.com
- **Source:** `offchain/signal-api.py`
- **Endpoints:**
  - `GET /signal` — all signals (all chains × all feeds)
  - `GET /signal/{chain_id}/{SYMBOL}` — e.g. `/signal/46630/AAPL`
  - `GET /signal/{SYMBOL}` — defaults to Robinhood Chain (46630)
  - `GET /health` — service status

Per-chain session-aware price signals for AAPL, TSLA, NVDA.

## Monitoring

Both services are pinged every 5 minutes by UptimeRobot to prevent Render free-tier sleep.

## For the frontend

```js
const INDEXER_URL = "https://trisara-indexer.onrender.com";
const SIGNAL_URL = "https://trisara-signal-api.onrender.com";

const chains = await fetch(`${INDEXER_URL}/state`).then(r => r.json());
const signals = await fetch(`${SIGNAL_URL}/signal`).then(r => r.json());
```
