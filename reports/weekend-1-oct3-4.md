# Weekend Report #1 — The Freeze and the Thaw
**Trisara · Crypto World's Fair · October 3–5, 2026**
*Final — merged dataset: 2,836 rows, 2026-10-03T10:05Z → 2026-10-05T16:05Z (54 hours).*
*Published October 9, 2026.*

---

## 1. What we logged

Every 60 seconds, October 3–5, 2026:

- **Chainlink equity feeds on Robinhood Chain** (mainnet): AAPL, TSLA, NVDA — price + `updatedAt` staleness, 8 decimals, via `latestRoundData()`.
- **Hyperliquid `allMids`** — equity-perp drift watch (HIP-3).

Read-only. No transactions, no keys. Two loggers: Parv's laptop (2,780 rows, full weekend) and a VM copy (56 rows, takeover ~18:10–19:07 IST Oct 5 after the laptop slept on lid-close). Merged on `ts`, sorted; no dedup needed (independent poll times).

## 2. The freeze — 37.7 hours, zero new rounds

All three feeds pinned at Friday's prints with **no new Chainlink rounds at all** — not just unchanged prices, but frozen `updatedAt`:

| Feed | Friday print | Frozen from | Frozen until | Duration |
|------|-------------|-------------|--------------|----------|
| AAPL | 333.8239 | Oct 3 10:17Z | Oct 5 00:00Z | **37.7 h** |
| TSLA | 370.4480 | Oct 3 10:17Z | Oct 5 00:00Z | **37.7 h** |
| NVDA | 234.9971 | Oct 3 10:17Z | Oct 5 00:00Z | **37.7 h** |

**Onchain bounds (Robinhood Chain mainnet): block 79,006,300 → block 80,345,978.** Anyone can verify: no new Chainlink rounds for these three feeds between these blocks. (Block timestamps matched to the second via binary search on `eth_getBlockByNumber`, October 9, 2026.)

1,918 consecutive rows per feed, zero price movement, zero heartbeat. Any venue pricing off these feeds flew blind for over a day and a half.

**Monday drift (Oct 5 00:00Z → ~12:56Z):** sparse rounds resumed with small moves (AAPL −0.09%, TSLA wandering 370.45→372.29→374.24→372.36→370.38→368.51, NVDA +0.09%→+0.6%→+0.09%). Feeds stirring, not live — staleness still measured in hours.

## 3. The thaw — staggered, not synchronized

| Feed | First live update (IST) | First live price | Gap vs Friday print |
|------|------------------------|-----------------|---------------------|
| AAPL | ~18:26:56 | 331.7627 | **−0.53%** |
| NVDA | ~18:58:20 | 236.4912 | **+0.54%** |
| TSLA | ~19:01:30 | 366.4860 | **−0.55%** |

Wake-ups span ~35 minutes: AAPL pre-bell, NVDA 2 min pre-bell, TSLA 1 min post-bell. "Feeds go live at the open" is wrong in both directions.

After waking, normal live behavior: heartbeat staleness of tens to low hundreds of seconds, prices moving (by 16:05Z: AAPL 334.11, TSLA 378.50 — **+2.2%** from Friday — NVDA 236.57).

### Three observations

**1. The freeze was absolute, then the thaw was ragged.** 37.7 hours of nothing, then three independent wake-ups minutes apart. There is no single "market open" signal in these feeds.

**2. Friday's prints were wrong by ~0.5%.** Any liquidation, perp mark, or collateral valuation computed off these stale prints during the freeze used a price about half a percent away from the first live print. We can't name which specific valuations were wrong without a venue's liquidation book — but the pricing error was real and measurable, and its direction differed by feed: AAPL/TSLA gapped *down* (stale prints *overstated* collateral → under-liquidation, bad-debt risk); NVDA gapped *up* (stale prints *understated* collateral → wrongful-liquidation risk). Same freeze, opposite victims.

**3. Even "live" has a lag window.** Post-wake staleness of 100–300s between heartbeats is normal Chainlink behavior — the question is never *whether* lag exists, only whether the venue *knows* it's in one.

### Honest caveats

- AAPL's first live round came ~34 min pre-bell (18:26 IST). Possible pre-market reference data — observed, not explained.
- TSLA's Monday pre-market drift (13.5h of sparse moves before the true thaw) shows "frozen" has shades; the 37.7h figure is the *zero-round* freeze, the strictest measure.

## 4. What this means

A venue pricing off these feeds was blind for 37.7 hours — then got three *different* "all clear" signals minutes apart, each landing ~0.5% away from the number it had been using. No on-chain clock distinguished "frozen" from "live," or one feed's liveness from another's. That missing clock is what Trisara builds.

## 5. Data integrity

- **Gap inventory** (8 gaps >3 min in 2,836 rows): 41.4 min (Oct 3 13:57Z), 35.9 min (Oct 4 06:10Z), **204.9 min (Oct 4 17:20Z–20:45Z)**, 11.9/7.1/10.9 min (Oct 5 03:48–05:40Z), 22.3 min (Oct 5 11:38Z), 14.2 min (Oct 5 13:01Z). All gaps fall inside frozen regimes — a missing reading cannot fabricate a price update, and no segment boundary falls inside a gap.
- **Feed health:** AAPL 99.0% / TSLA 98.9% / NVDA 99.1% / HL 99.6% of rows OK.
- **Logger scripts:** `offchain/weekend1-logger.py` (Parv's laptop; unmodified) and VM copy (curl-based `rpc_call` — VM-only workaround for the RH RPC's WAF blocking Python's TLS fingerprint).
- **Merged file:** 2,836 rows, 70MB. Parv's original `.gz` verified intact before decompression.
- **Not claimed:** no honest single "money protected" figure exists without a venue's actual liquidation book; no named HIP-3 drift, no pool-state replay — only what was collected.
