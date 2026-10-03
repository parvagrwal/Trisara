# S11 Spec: COLLAR vs DEFER — GuardedSwapRouter

**Status:** LOCKED (Oct 3, 2026) · **Decision:** Ship COLLAR + instant refund Day 4 (CORE). DEFER escrow queue is STRETCH — cut if not green by Oct 6, 18:00 ET.

## 1. Problem

When `PriceIntegrity` reports a price outside the allowed band (e.g. HIMS at $132.64 vs $28.84 Friday close = +360%, state `CLOSED·DISLOCATED`), the router must not fill the swap at the dislocated print. Two behaviors:

| | COLLAR (CORE) | DEFER (STRETCH) |
|---|---|---|
| Outside-band swap | Revert + instant refund, same tx | Escrow tokens, fill at reopening |
| State stored | None | `DeferredOrder` per order |
| User action needed | Re-submit later | `claimFill()` or `cancelDeferred()` |
| LoC budget | < 60 | < 120 total |

## 2. Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGuardedSwapRouter {
    enum Mode { COLLAR, DEFER }

    struct DeferredOrder {
        address user;
        address tokenIn;
        uint256 amountIn;
        address tokenOut;
        uint256 minAmountOut;
        uint256 createdAt;
        uint256 expiresAt;
        bool filled;
        bool cancelled;
    }

    event OrderDeferred(bytes32 indexed orderId, address indexed user, address tokenIn, uint256 amountIn);
    event OrderFilled(bytes32 indexed orderId, uint256 amountOut);
    event OrderCancelled(bytes32 indexed orderId);

    /// @notice COLLAR: reverts + refunds outside band (no state).
    ///         DEFER: escrows input, emits OrderDeferred, returns orderId.
    function guardedSwap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut, Mode mode)
        external returns (bytes32 orderId);

    /// @notice Fill a deferred order once State returns to OPEN. Reverts while halted.
    function claimFill(bytes32 orderId) external;

    /// @notice Cancel + full refund. NEVER reverts in any State/Flag (INV-5).
    function cancelDeferred(bytes32 orderId) external;

    function getOrder(bytes32 orderId) external view returns (DeferredOrder memory);
}
```

## 3. Invariant compliance

- **INV-5:** `cancelDeferred()` never reverts — no state checks, no oracle reads; pure token transfer back to `order.user`. `claimFill()` MAY revert (only while halted/dislocated); that is the safe direction.
- **INV-2:** `expiresAt = createdAt + maxDefer` (default 24h); anyone may call `cancelDeferred()` after expiry — no stuck funds, no keeper needed.
- **INV-1:** Router holds escrowed ERC-20s only during DEFER; never native balance; no `transfer`/`transferFrom` selectors on core contracts (router is a consumer, not core).
- **INV-6:** `evaluateState()` stays pure/view — the router reads `(State, Action, ReasonCode)` but never mutates oracle state.

## 4. Hyperliquid composition

`GuardedLender` (HyperEVM) uses the same `DEFER` action semantics for liquidations: when `markPx` dislocates, liquidation is deferred to `REOPENING` instead of executing at the squeezed print (cf. JELLY Mar 2025 replay). Hyperliquid's ~8s block finality is irrelevant to the defer window — `maxDefer`/`maxHalt` are measured in hours, orders of magnitude above finality. The `Rulebook` DEFER action is chain-agnostic; each consumer implements escrow/claim in its own token context.

## 5. Cut criteria (binding)

If onchain DEFER escrow is not passing invariant tests by **Oct 6, 18:00 ET**, ship `GuardedSwapRouter` with COLLAR + instant refund only. Out-of-collar swaps revert with `ReasonCode.OUTSIDE_COLLAR_DEFER_TO_OPEN`. The `Mode` enum and `DeferredOrder` struct stay in the interface (reserved, unused) so a later DEFER addition is non-breaking.
