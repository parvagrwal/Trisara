# BANK_US Anchor: UTC Day-Boundary Edge Case

**Status:** Documented, accepted. Fix deferred to v2.
**Found:** 2026-10-10 during Day 7 Tempo Fed anchor verification.
**Severity:** Low. Permissive (not restrictive), 4-hour window, holidays only.

## The issue

`AnchorClock.isOpen()` computes the day index from the UTC timestamp.
The `BANK_US` anchor (Federal Reserve) has no intraday hours by design —
it answers "is today a banking day?" for the whole day.

On Fed holidays, from 20:00 to 24:00 ET, the UTC date has already rolled
to the next day. If the next day is a banking day (e.g., the Tuesday after
a Monday holiday), `isOpen(BANK_US, ts)` returns `true` during those 4 hours
when the Fed is actually closed.

## Impact

- Window: 20:00–24:00 ET on Fed holidays only (~9 days/year).
- Direction: permissive. The Tempo `PriceIntegrity` treats prices as live
  when the Fed is closed. It does not block legitimate activity.
- Trading activity during these hours on holidays is near zero.
- Not a safety hole. No funds at risk.

## Verification

Onchain (Tempo testnet 42431, AnchorClock `0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA`):

| Time (ET)              | Expected | Actual |
|------------------------|----------|--------|
| Mon Oct 12 12:00 (holiday) | CLOSED | CLOSED |
| Mon Oct 12 21:00 (holiday) | CLOSED | OPEN   |
| Sat Oct 10 (weekend)   | CLOSED | CLOSED |
| Tue Oct 13 (banking day) | OPEN | OPEN   |

## v2 fix (proposed)

Compute the day index from the ET date, not the UTC date. The contract
already has DST logic (`_isDST`), so ET midnight is derivable:

```solidity
// Current (UTC-based):
uint256 dayIdx = timestamp / 1 days;

// Proposed (ET-based):
uint256 etTimestamp = _isDST(timestamp / 1 days)
    ? timestamp - 4 hours
    : timestamp - 5 hours;
uint256 dayIdx = etTimestamp / 1 days;
```

The holiday bitmaps are unchanged. The equity anchor (`EQUITY_US`) is
unaffected (its intraday session bounds already handle the rollover).

## Decision

Accepted as documented. The deployed contracts are immutable. The fix
is queued for v2 if the contracts are redeployed for any other reason.
