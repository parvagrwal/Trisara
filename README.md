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

Deployed on three testnets (all testnet-only, no mainnet):

| Chain | Chain ID | AnchorClock | Rulebook | PriceIntegrity |
|-------|----------|-------------|----------|----------------|
| Robinhood Chain | 46630 | `0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6` | `0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC` | `0x8bC2D43D3112AdE6460685295A70bF7C31E68B5A` |
| HyperEVM | 998 | `0xC2529BD7e5C8038516908189A142070953b7ad2e` | `0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b` | `0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6` |
| Tempo | 42431 | `0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA` | `0x713420180cec1E1EF394fb9e2606e0bd14764014` | `0x46E1d6DF88D19aFCcF70113471CA55F6Ccb05818` |

Robinhood 46630 consumers: GuardedSwapRouter `0x688639EFA88f019339756053Ff8e86D69f85eA56` (wired to GuardedFeed `0xe3539e762fDb42b93899566b685844c61ECc5575`), GuardedLender `0x78CEC9096Cb77f6784eA994043C7a78cb1C7bAaF`, GuardedSettlementRouter `0xa1Faeff982aa8eed064014Bcc1000F6B71e4AC2d`.

## Tests

```bash
forge test
```

128 tests, 0 failed. Slither automated scan: 0 high-severity findings ([report](docs/audits/SLITHER_SUMMARY.md)). This is a self-review, not a formal audit — not cleared for mainnet.

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

## Future work

- **CREATE2 deterministic deployment** — deploy core contracts to the same address on all 3 chains using a shared salt. Simplifies UI integration (one address works everywhere).
- **MPP integration** — opportunistic scope from Oct 7, not yet explored.
- **Rulebook-driven consumers** — wire `Rulebook.decision()` into consumer contracts so onchain enforcement matches the published policy (currently the indexer and signal API read the Rulebook offchain).
- **24/5 market phases** — model pre-market, post-market, and overnight sessions instead of binary OPEN/CLOSED (currently weekends and holidays only).
- **Lender liquidation economics** — review the 100%-seizure liquidation design and keeper-set reference price rate limits.
- **Pre-submission checklist** — test all public links in an incognito browser; rehearse 5 pressure-test Q&A answers out loud (30 min mock interview).

## License

MIT
