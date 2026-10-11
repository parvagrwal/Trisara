# Trisara Production Backend — Runbook

## What this is

Two services that feed data to the frontend. Both are read-only. No keys, no transactions.

## Service 1: Indexer (required)

Polls all 3 chains for AnchorClock + Rulebook state. Writes `state/latest.json`.

```bash
cd ~/Trisara/indexer
npm install          # first time only
npm run poll         # loop every 60s
```

For a single snapshot:

```bash
npm run poll:once
```

**What's production about it:**
- 2 RPC endpoints per chain with automatic failover (viem `fallback`)
- Chains poll in parallel — one slow chain doesn't block the others
- Every chain entry has `healthy`, `polledAt`, `latencyMs`
- Output validated before write — corrupt snapshots never hit disk
- Atomic writes (tmp + rename) — readers never see half-written files
- Schema versioned (`schemaVersion: 2`) for future UI compatibility

**Output:** `indexer/state/latest.json`

## Service 2: Signal API (optional, Dwellir pilot)

Serves session-aware price signals for AAPL/TSLA/NVDA on Robinhood Chain.

```bash
cd ~/Trisara/offchain
python signal-api.py --port 8080
```

Endpoints:
- `GET /signal` — all feeds
- `GET /signal/AAPL` — one feed
- `GET /health` — service status

**Logic (fixed 2026-10-12):** session is checked FIRST.
- CLOSED + stale → COLLAR (staleness is normal on weekends, not a fault)
- OPEN + stale ≥15min → HALT (real fault, fail closed)
- Feed error → HALT

## Running both

Open two Git Bash terminals. Run the indexer in one, the signal API in the other.
The future UI reads from both.

## Files

| File | Purpose |
|------|---------|
| `indexer/poller.ts` | Chain state poller (hardened) |
| `indexer/state/latest.json` | Unified chain state (generated) |
| `offchain/signal-api.py` | Price signal server (fixed ordering) |
| `offchain/signal/latest.json` | Latest signals snapshot (generated) |
