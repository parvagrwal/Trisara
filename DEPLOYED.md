# Deployed Services

Live production endpoints for the Trisara backend. Both are read-only, no keys.

## Indexer

- **URL:** https://trisara-indexer.onrender.com
- **Source:** `indexer/server.ts` (wraps `indexer/poller.ts`)
- **Endpoints:**
  - `GET /state` — full chain snapshot (all 3 testnets)
  - `GET /health` — service status

Polls AnchorClock + Rulebook on all 3 chains every 60s. Clock is evaluated at the chain's block timestamp, not server time.

## Signal API

- **URL:** https://trisara-signal-api.onrender.com
- **Source:** `offchain/signal-api.py`
- **Endpoints:**
  - `GET /` — service info and endpoint list
  - `GET /signal` — all signals (all chains × all feeds)
  - `GET /signal/{chain_id}/{SYMBOL}` — e.g. `/signal/46630/AAPL`
  - `GET /signal/{SYM}` — defaults to Robinhood Chain (46630)
  - `GET /health` — service status

Per-chain session-aware price signals for AAPL, TSLA, NVDA.

## Contract addresses

All testnet-only.

**Robinhood Chain testnet (46630):**
- AnchorClock `0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6`
- Rulebook `0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC`
- PriceIntegrity `0x8bC2D43D3112AdE6460685295A70bF7C31E68B5A`
- GuardedFeed `0xe3539e762fDb42b93899566b685844c61ECc5575`
- GuardedSwapRouter `0x688639EFA88f019339756053Ff8e86D69f85eA56`
- GuardedLender `0x78CEC9096Cb77f6784eA994043C7a78cb1C7bAaF`
- GuardedSettlementRouter `0xa1Faeff982aa8eed064014Bcc1000F6B71e4AC2d`

**HyperEVM testnet (998):**
- AnchorClock `0xC2529BD7e5C8038516908189A142070953b7ad2e`
- Rulebook `0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b`
- PriceIntegrity `0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6`

**Tempo Moderato testnet (42431):**
- AnchorClock `0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA`
- Rulebook `0x713420180cec1E1EF394fb9e2606e0bd14764014`
- PriceIntegrity `0x46E1d6DF88D19aFCcF70113471CA55F6Ccb05818`

## Monitoring

Both services are pinged every 5 minutes by UptimeRobot to prevent Render free-tier sleep.

## For the frontend

```js
const INDEXER_URL = "https://trisara-indexer.onrender.com";
const SIGNAL_URL = "https://trisara-signal-api.onrender.com";

const chains = await fetch(`${INDEXER_URL}/state`).then(r => r.json());
const signals = await fetch(`${SIGNAL_URL}/signal`).then(r => r.json());
```
