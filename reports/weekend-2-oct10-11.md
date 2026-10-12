# Weekend Report #2 — The Long Freeze and the Columbus Day Split
**Trisara · Crypto World's Fair · October 9–12, 2026**
*Final — 3,700 rows across 5 log files, 2026-10-05 → 2026-10-12.*
*Published October 13, 2026.*

---

## 1. What we logged

Every 60 seconds, October 9–12, 2026:

- **Chainlink equity feeds on Robinhood Chain** (mainnet): AAPL, TSLA, NVDA — price + `updatedAt` staleness, 8 decimals, via `latestRoundData()`.
- **Hyperliquid `allMids`** — equity-perp drift watch (HIP-3).

Read-only. No transactions, no keys.

| File | Rows | Window |
|------|------|--------|
| `weekend1-20261005.jsonl` | 56 | Oct 5 (Weekend 1 tail) |
| `weekend1-20261009.jsonl` | 467 | Oct 9 (Friday session → close) |
| `weekend1-20261010.jsonl` | 1,132 | Oct 10 (Saturday) |
| `weekend1-20261011.jsonl` | 1,200 | Oct 11 (Sunday) |
| `weekend1-20261012.jsonl` | 845 | Oct 12 (Monday → post-open) |
| **Total** | **3,700** | |

## 2. The freeze — 52 hours, zero new rounds

All three feeds pinned at Friday's prints through the weekend:

- **Longest unbroken freeze (all three symbols):** 51.99 hours, 2026-10-09T20:00:46Z → 2026-10-12T00:00:01Z.
- **Maximum staleness observed:** NVDA 204,646s (56.9h), TSLA 202,626s (56.3h), AAPL 188,304s (52.3h).

The theoretical full-closure window (Fri 20:00 UTC → Mon 13:30 UTC) is 65.5 hours. We measured ~52–57h because the feeds reset around midnight UTC Monday, then froze again in a shorter second window until the open. Intermittent pre-open updates also cut the maximum: TSLA last updated ~08:41 UTC Monday, NVDA ~11:03 UTC, AAPL ~13:27 UTC.

## 3. The price gap — frozen Friday vs live Monday

The stale weekend prints were wrong by more than Weekend 1's ~0.5%:

| Symbol | Frozen Friday print | First live Monday print | Gap |
|--------|---------------------|-------------------------|-----|
| AAPL | 336.63 | 342.42 | **+1.72%** |
| TSLA | 382.95 | 380.53 | **-0.63%** |
| NVDA | 230.36 | 227.72 | **-1.15%** |

Any liquidation, perp mark, or collateral valuation computed off these stale prints during the 52-hour freeze used a price up to 1.7% away from the first live print. Direction differed by symbol: AAPL's stale print understated value (wrongful-liquidation risk), TSLA/NVDA's overstated it (under-liquidation, bad-debt risk).

## 4. The Monday open — captured at 13:30 UTC

The open transition was logged with rows 6 seconds before and 56 seconds after 13:30 UTC:

| Symbol | Staleness before (13:29:54Z) | Staleness after (13:30:56Z) |
|--------|------------------------------|------------------------------|
| AAPL | 197s | 18s |
| TSLA | 17,288s (4.8h) | 4s |
| NVDA | 8,821s (2.45h) | RPC error (`IncompleteRead`); 8,945s at 13:31:58 |

TSLA is the cleanest open-transition signal in the dataset: 4.8 hours of staleness collapsing to 4 seconds at the bell. AAPL was already nearly live before the open (197s → 18s).

### Honest caveats

- The "before" snapshot does **not** show ~200k-second staleness: a midnight-Monday feed reset cut staleness before the open. The ~200k-level readings are visible in the data just before that reset, not in the final pre-open row.
- **NVDA did not refresh at the open** within the observed window — still ~9,130s stale through 14:34 UTC, when logging ended. Feed behavior varies by symbol; the guard handles it, but the data is uneven.

## 5. The Columbus Day split — one date, two sessions

Monday Oct 12, 2026 was Columbus Day: the NYSE was open, the Federal Reserve was closed. AnchorClock's per-anchor calendars captured the divergence onchain:

| Anchor | Calendar | Oct 12 reading |
|--------|----------|----------------|
| NYSE (Robinhood 46630, HyperEVM 998) | Equities | OPEN |
| BANK_US (Tempo 42431) | Fed | CLOSED |

Verified onchain: Tempo AnchorClock `0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA` returned CLOSED at 12:00 ET Oct 12 and OPEN on Tue Oct 13.

This is the case the per-anchor design exists for: a single global "market open" boolean would have been wrong for one of the two calendars. Session state is not one thing — it is per-venue, per-calendar, per-action.

Known edge case: on Fed holidays, 20:00–24:00 ET, the UTC day boundary rolls before ET midnight, so `isOpen(BANK_US, ts)` reads true during those 4 hours. Permissive direction only, no funds at risk. Documented in [docs/BANK_US_EDGE_CASE.md](../docs/BANK_US_EDGE_CASE.md).

## 6. What this means

Two weekends, two measurements, same conclusion. Weekend 1: 37.7 hours of absolute freeze. Weekend 2: up to 56.9 hours of staleness, a ragged pre-open thaw, one feed that never woke up by the time logging ended, and a holiday that split the NYSE from the Fed on the same calendar date.

No on-chain clock distinguished "frozen" from "live" in any of it — or one feed's liveness from another's, or one calendar's holiday from another's session. That missing clock is what Trisara builds.

## 7. Data integrity

- **Logger:** `offchain/weekend1-logger.py`, 60s cadence, read-only Chainlink `latestRoundData()` + Hyperliquid `allMids`.
- **Coverage:** 3,700 rows; Hyperliquid endpoint healthy on both sides of the Monday open.
- **Not claimed:** no honest single "money protected" figure exists without a venue's actual liquidation book; the ~200k-second peaks are real measurements from before the Monday-midnight reset, not from the final pre-open row.
