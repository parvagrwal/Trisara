# Trisara

**Real-world assets came onchain without their clocks. Trisara is the escapement.**

Trisara is session-aware infrastructure for tokenized stocks. Every trade checks the market session before it executes — no more liquidations on stale weekend prices, no more swaps at Monday's open using Friday's close.

Built for [Colosseum Crypto World's Fair](https://colosseum.com). Tracks: Tempo, Hyperliquid, Robinhood Chain.

## How it works

```
Guarded Router → GuardedFeed → PriceIntegrity → AnchorClock
```

- **AnchorClock** — onchain market calendar (NYSE hours + 2026-27 holiday bitmaps)
- **PriceIntegrity** — validates prices against session state
- **GuardedFeed** — session-aware price feed (collar/defer/halt when closed)
- **Rulebook** — standalone venue contract for custom session rules
- **Guarded routers/lender** — swap, borrow, and settlement with session enforcement

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full call paths.

## Contracts

Deployed on three testnets:

| Chain | Chain ID | Core contracts |
|-------|----------|----------------|
| Robinhood Chain | 46630 | AnchorClock, GuardedFeed, Rulebook, GuardedSwapRouter |
| HyperEVM | 998 | AnchorClock, GuardedFeed, Rulebook, GuardedLender |
| Tempo | 42431 | AnchorClock, GuardedFeed, Rulebook, GuardedSettlementRouter |

## Tests

```bash
forge test
```

128 tests, 0 failed. Slither scan: 0 high-severity findings ([report](docs/audits/SLITHER_SUMMARY.md)).

## Backend services

Live and monitored:

| Service | URL | Source |
|---------|-----|--------|
| Indexer | https://trisara-indexer.onrender.com | `indexer/` |
| Signal API | https://trisara-signal-api.onrender.com | `offchain/signal-api.py` |

See [DEPLOYED.md](DEPLOYED.md) for endpoints. See [indexer/RUNBOOK.md](indexer/RUNBOOK.md) to run locally.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — onchain call paths
- [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) — security review
- [docs/audits/SLITHER_SUMMARY.md](docs/audits/SLITHER_SUMMARY.md) — automated audit

## License

MIT
