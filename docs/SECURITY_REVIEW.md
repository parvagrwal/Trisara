# Trisara Security Review — Day 6 Gate

**Date:** 2026-10-10
**Scope:** `src/consumers/` (GuardedSwapRouter, GuardedLender, GuardedSettlementRouter + unguarded twins + ProtectionBilling), `src/adapters/` (ReferenceFeedAdapter, LivenessAdapter), deployment wiring on RH testnet 46630.
**Out of scope:** Day-2 core (AnchorClock, PriceIntegrity, Rulebook, GuardedFeed, QuorumFlagger) — reviewed Day 2, 72 tests green. `src/testnet/` helpers are testnet-only by design.
**Method:** Manual code read against the Day-6 checklist (reentrancy, CEI, oracle manipulation, donation/inflation, decimals, tighten-only). Automated Slither scan on 2026-10-12: 0 high-severity findings (see [audits/SLITHER_SUMMARY.md](audits/SLITHER_SUMMARY.md)). No formal external audit yet — required before mainnet.

## Findings

### HIGH — Deployment: lender decimal mismatch on 46630 (must fix before mainnet)

`GuardedLender._collateralValue` computes `valueWad` in 18-decimal units and the contract documents: *"both 18-dec normalized here; pass 18-decimal tokens or scale at integration."*

The 46630 deployment pairs 18-dec TSLA collateral with **6-dec rUSDG debt**. The borrow cap (`maxBorrow`) is therefore **1e12x too permissive**: 1 TSLA (~$387) allows borrowing up to ~1.9e20 rUSDG-units instead of ~193.5 rUSDG. Actual loss is capped at the lender's funded inventory (5,000 rUSDG on testnet), but the math is wrong and the liquidation check inherits the same mismatch.

**Fix (pick one before any mainnet use):** (a) deploy the lender with an 18-decimal debt token, or (b) add decimal scaling to the lender (read `debtToken.decimals()` once, scale `maxBorrow` / comparisons). Option (b) is the durable fix; it needs new tests + redeploy.

### MEDIUM — Code: no ReentrancyGuard on consumers

CEI ordering is correct in every state-changing function reviewed (state is written before every external token transfer: `swap`/`executeDeferred`/`claimRefund`, `borrow`/`repay`/`withdrawCollateral`/`liquidate`, `settle`/`releaseHold`/`claimRefund`). No theft vector was found.

But the implementation plan (§12) requires `ReentrancyGuardTransient`/`ReentrancyGuard` on all state-changing consumer routers/lenders, and it is absent. CEI is necessary but not sufficient as a guarantee against future edits. **Recommendation:** add `ReentrancyGuard` to `swap`, `executeDeferred`, `borrow`, `liquidate`, `settle`, `releaseHold` before mainnet.

### LOW — Code: `pegToleranceBps` is stored but never enforced

`GuardedSettlementRouter` stores `pegToleranceBps` (immutable) but no code path reads it. The peg-break decision is fully delegated to the adapter's `ok` flag. Either enforce the tolerance in the router (compare adapter price deviation) or remove the field — dead config creates a false sense of control.

### LOW — Code: `ReferenceFeedAdapter._toWad` assumes feedDecimals <= 18

`a * (10 ** (18 - feedDecimals))` reverts (instead of returning `ok=false`) if a feed ever reports >18 decimals. No Chainlink feed does this today, but the function's contract is "never reverts on bad data." Document the assumption or clamp.

### INFO — Router has no staleness check of its own

`GuardedSwapRouter.swap` / `_guardedPrice` read `latestRoundData` but ignore `updatedAt`. Staleness is enforced one layer down (by `GuardedFeed` or a freshness-checking adapter). On the 46630 testnet deployment the router is wired to the **raw** MockAggregator, not the deployed GuardedFeed — fine for the demo, but production wiring must be `GuardedFeed` (or equivalent) so a frozen feed cannot be quoted.

### INFO — Liquidations are full, not partial

`GuardedLender.liquidate` seizes 100% of collateral and covers 100% of debt. This is the documented minimal-lender design, but it is harsher than production lenders; note it for the venue docs.

## Checklist results

| Check | Result |
|---|---|
| Reentrancy | CEI correct everywhere; no guard present (MEDIUM above) |
| CEI ordering | Pass — state before external calls in all 12 state-changing functions |
| Oracle manipulation | INV-7 holds: liquidations trigger on refFeed only; venue price can restrict borrowing but never liquidate a healthy account. Swap collar enforced vs keeper reference; DEFER + always-available refund (INV-5) bounds keeper misbehavior |
| Donation / inflation | Pass — no `balanceOf`-based accounting anywhere; all positions tracked in explicit mappings |
| Decimals | **Fail (deployment)** — lender assumes 18-dec debt; 46630 uses 6-dec rUSDG (HIGH above). Router/adapter decimal math verified correct for (6, 18, 8) |
| Tighten-only | Pass — keeper can set reference price and fund, but users can always `claimRefund`; no path to lock funds or loosen the collar beyond its immutable bound |
| Overflow | Pass — Solidity 0.8 checked math; absurd inputs revert, no silent wrap |

## Conclusion

The code is **conditionally cleared for testnet** and **not cleared for mainnet** until the HIGH (lender decimals) and MEDIUM (reentrancy guards) items are resolved. The LOW/INFO items should be addressed or explicitly accepted in the same pass. No funds are at risk on testnet (mock feeds, faucet tokens, capped inventories).

## Fix log (2026-10-10)

- **HIGH (lender decimals): FIXED.** `GuardedLender` now reads `collDec`/`debtDec` in the constructor and values collateral via `_debtValue()` in debt-token units. Same fix applied to `UnguardedLender`. Regression test `testLender_sixDecimalDebtScalesCorrectly` added (6-dec debt, exact 50% LTV boundary). 128/128 tests green.
- **MEDIUM (reentrancy guards): FIXED.** New `src/ReentrancyGuard.sol` (SSTORE-based; EVM Paris has no transient storage). `nonReentrant` applied to all state-changing functions in `GuardedSwapRouter`, `GuardedLender`, `GuardedSettlementRouter`, `ProtectionBilling`, and both unguarded twins.
- **LOW (pegToleranceBps): FIXED.** `GuardedSettlementRouter.settle` now enforces the tolerance onchain: while the Fed anchor is CLOSED, a peg price deviating more than `pegToleranceBps` from $1.00 routes to `PEG_BREAK_CLOSED` hold, in addition to the adapter `!ok` path.
- **LOW (_toWad assumption): ACCEPTED.** Documented; no Chainlink feed exceeds 18 decimals.
- **INFO (router staleness): ACCEPTED.** Production wiring must use `GuardedFeed`; noted for deployment runbook.
- **INFO (full liquidation): ACCEPTED.** Documented design choice.
