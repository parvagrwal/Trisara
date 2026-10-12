# Regulatory Memo: Robinhood Chain

**Date:** 2026-10-10
**Scope:** Trisara protocol deployment on Robinhood Chain (testnet 46630).
This memo is informational, not legal advice.

## What Trisara does on Robinhood Chain

Trisara is session-aware pricing infrastructure. It does not issue tokens,
hold customer funds, or operate a trading venue. Specifically:

- **AnchorClock**: Onchain NYSE calendar. Read-only, no funds.
- **PriceIntegrity**: Evaluates whether a price feed is trustworthy given
  the session state. Read-only, no funds.
- **Rulebook**: Venue-published rules (collar, cap, defer, halt). The venue
  admin publishes rules; the contract enforces them.
- **GuardedSwapRouter / GuardedLender**: Execute swaps and loans through
  the session-aware guards. Non-custodial: users retain control, the router
  never holds funds beyond the atomic transaction.

## Key regulatory considerations

1. **No custody.** Trisara contracts do not hold user funds between
   transactions. The guarded routers execute atomically and return funds
   immediately. This is infrastructure, not a custodial service.

2. **No token issuance.** Trisara issues no tokens. It interacts with
   existing tokenized equities (e.g., TSLA, rUSDG) on Robinhood Chain.

3. **Oracle integrity, not price setting.** Trisara does not set prices.
   It reads Chainlink feeds and determines whether the session state makes
   those prices trustworthy. It is a safety layer, not a pricing authority.

4. **Venue responsibility.** The Rulebook is published by the venue admin.
   Trisara provides the mechanism; the venue decides the rules. Regulatory
   obligations for the trading venue itself (licensing, KYC, etc.) remain
   with the venue operator.

5. **Testnet only.** Current deployment is on Robinhood Chain testnet
   (46630). No mainnet deployment, no real funds.

## Open questions for mainnet

- Whether session-aware guardrails constitute a "trading control" requiring
  venue licensing in any jurisdiction.
- Data reporting obligations if the protocol is used by a regulated venue.
- Cross-chain considerations if the same rulebook governs multiple chains.

These require qualified legal counsel before any mainnet deployment.
