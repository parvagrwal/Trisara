#!/usr/bin/env bash
# Trisara testnet deploy — Day 5.
# Deploys in three tiers:
#   TIER 1 (always): core with zero external deps — AnchorClock, Rulebook,
#                    PriceIntegrity, LivenessAdapter.
#   TIER 2 (needs FEED_* env): GuardedFeed, ReferenceFeedAdapter,
#                    PoolTwapAdapter, PoolSpotReader, HyperCoreAdapter (HL),
#                    TempoStableAdapter (Tempo).
#   TIER 3 (needs TOKEN_* env): GuardedSwapRouter, UnguardedSwapRouter,
#                    GuardedLender, UnguardedLender, GuardedSettlementRouter,
#                    UnguardedSettlementRouter, ProtectionBilling.
# Writes deployed addresses to deployments/<chain-id>.json
#
# Usage:
#   export PRIVATE_KEY=0x...            # deployer key (NEVER commit)
#   export RPC_URL=https://...          # testnet RPC
#   # optional, tier 2/3:
#   export FEED_HIMS=0x... POOL_HIMS_USDC=0x... TOKEN_USDC=0x... TOKEN_HIMS=0x...
#   export FEE_TOKEN=0x... POLICY=0x...
#   bash script/deploy-testnet.sh
#
# Notes:
# - Uses `forge create --gas-limit` (Tempo Moderato needs an explicit gas
#   limit; `forge script` estimation fails there — S8 lesson).
# - Anchor: 0 = EQUITY_US (RH/HL), 1 = BANK_US (Tempo). Override with ANCHOR.
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${RPC_URL:?set RPC_URL}"

CHAIN_ID="${CHAIN_ID:-$(cast chain-id --rpc-url "$RPC_URL")}"
ANCHOR="${ANCHOR:-0}"
GAS_LIMIT="${GAS_LIMIT:-3000000}"
OUT="deployments/${CHAIN_ID}.json"
mkdir -p deployments

echo "Deploying to chain ${CHAIN_ID} (anchor=${ANCHOR}) via ${RPC_URL}"

deploy() { # name path:Contract [constructor args...] — prints ONLY the address on stdout
  local name="$1" target="$2"; shift 2
  echo "--- ${name}" >&2
  local args=()
  if [ $# -gt 0 ]; then args=(--constructor-args "$@"); fi
  local addr
  # shellcheck disable=SC2128
  if [ "${#args[@]}" -gt 0 ]; then
    addr=$(forge create --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --gas-limit "$GAS_LIMIT" "$target" "${args[@]}" 2>&1 \
      | grep -oE "Deployed to: 0x[0-9a-fA-F]{40}" | awk '{print $3}')
  else
    addr=$(forge create --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --gas-limit "$GAS_LIMIT" "$target" 2>&1 \
      | grep -oE "Deployed to: 0x[0-9a-fA-F]{40}" | awk '{print $3}')
  fi
  if [ -z "$addr" ]; then echo "FAILED: ${name}" >&2; exit 1; fi
  echo "${name} -> ${addr}" >&2
  printf "%s" "$addr"
}

json_add() { # key value — accumulates into JSON_ENTRIES (pure bash, no python/jq)
  local k="$1" v="$2"
  if [ -z "${JSON_ENTRIES:-}" ]; then
    JSON_ENTRIES="  \"$k\": \"$v\""
  else
    JSON_ENTRIES="${JSON_ENTRIES},
  \"$k\": \"$v\""
  fi
}

json_write() {
  printf "{\n%s\n}\n" "${JSON_ENTRIES:-}" > "$OUT"
}

# ---------------- TIER 1: core, no external deps ----------------
CLOCK=$(deploy "AnchorClock" "src/AnchorClock.sol:AnchorClock")
json_add AnchorClock "$CLOCK"

RULEBOOK=$(deploy "Rulebook" "src/Rulebook.sol:Rulebook" \
  "${DEPLOYER:?set DEPLOYER}" "${DEPLOYER}" 86400)
json_add Rulebook "$RULEBOOK"

# PriceIntegrity config: (deviationBps, velocityBps, velocityWindow, maxFreshness, reopenGrace)
INTEGRITY=$(deploy "PriceIntegrity" "src/PriceIntegrity.sol:PriceIntegrity" \
  "$CLOCK" "$ANCHOR" "(500,1000,300,900,900)")
json_add PriceIntegrity "$INTEGRITY"

LIVENESS=$(deploy "LivenessAdapter" "src/adapters/LivenessAdapter.sol:LivenessAdapter" 300)
json_add LivenessAdapter "$LIVENESS"

# ---------------- TIER 2: feed-dependent adapters ----------------
if [ -n "${FEED_HIMS:-}" ]; then
  GF=$(deploy "GuardedFeed" "src/GuardedFeed.sol:GuardedFeed" \
    "$FEED_HIMS" "$INTEGRITY" "${DEPLOYER}" 500)
  json_add GuardedFeed "$GF"

  REF=$(deploy "ReferenceFeedAdapter" \
    "src/adapters/ReferenceFeedAdapter.sol:ReferenceFeedAdapter" "$FEED_HIMS" 900)
  json_add ReferenceFeedAdapter "$REF"
else
  echo "--- skip GuardedFeed/ReferenceFeedAdapter (FEED_HIMS not set)"
fi

if [ -n "${POOL_HIMS_USDC:-}" ]; then
  TWAP=$(deploy "PoolTwapAdapter" \
    "src/adapters/PoolTwapAdapter.sol:PoolTwapAdapter" "$POOL_HIMS_USDC")
  json_add PoolTwapAdapter "$TWAP"
  SPOT=$(deploy "PoolSpotReader" \
    "src/adapters/PoolTwapAdapter.sol:PoolSpotReader" 900 300 "${DEPLOYER}")
  json_add PoolSpotReader "$SPOT"
else
  echo "--- skip PoolTwapAdapter/PoolSpotReader (POOL_HIMS_USDC not set)"
fi

if [ "$CHAIN_ID" = "998" ] && [ -n "${HL_ASSET_INDEX:-}" ]; then
  HC=$(deploy "HyperCoreAdapter" \
    "src/adapters/HyperCoreAdapter.sol:HyperCoreAdapter" "$HL_ASSET_INDEX" true 6)
  json_add HyperCoreAdapter "$HC"
elif [ "$CHAIN_ID" = "998" ]; then
  echo "--- skip HyperCoreAdapter (HL_ASSET_INDEX not set)"
fi

if [ "$CHAIN_ID" = "42431" ] && [ -n "${TEMPO_DEX:-}" ] && [ -n "${FEE_TOKEN:-}" ]; then
  TSA=$(deploy "TempoStableAdapter" \
    "src/adapters/TempoStableAdapter.sol:TempoStableAdapter" \
    "$TEMPO_DEX" "$FEE_TOKEN" "${TEMPO_TARGET:-$FEE_TOKEN}" "${POLICY:-${DEPLOYER}}" 30)
  json_add TempoStableAdapter "$TSA"
elif [ "$CHAIN_ID" = "42431" ]; then
  echo "--- skip TempoStableAdapter (TEMPO_DEX/FEE_TOKEN not set)"
fi

# ---------------- TIER 3: consumers ----------------
if [ -n "${TOKEN_USDC:-}" ] && [ -n "${TOKEN_HIMS:-}" ] && [ -n "${FEED_HIMS:-}" ]; then
  GSR=$(deploy "GuardedSwapRouter" \
    "src/consumers/GuardedSwapRouter.sol:GuardedSwapRouter" \
    "$FEED_HIMS" "$TOKEN_USDC" "$TOKEN_HIMS" 500 "${DEPLOYER}" "${REF_PX:-3467028}")
  json_add GuardedSwapRouter "$GSR"
  USR=$(deploy "UnguardedSwapRouter" \
    "src/consumers/GuardedSwapRouter.sol:UnguardedSwapRouter" \
    "$FEED_HIMS" "$TOKEN_USDC" "$TOKEN_HIMS")
  json_add UnguardedSwapRouter "$USR"

  GL=$(deploy "GuardedLender" \
    "src/consumers/GuardedLender.sol:GuardedLender" \
    "$TOKEN_HIMS" "$TOKEN_USDC" "$CLOCK" "$ANCHOR" "${VENUE_FEED:-$FEED_HIMS}" "$FEED_HIMS" 900 0)
  json_add GuardedLender "$GL"
  UL=$(deploy "UnguardedLender" \
    "src/consumers/GuardedLender.sol:UnguardedLender" \
    "$TOKEN_HIMS" "$TOKEN_USDC" "${VENUE_FEED:-$FEED_HIMS}")
  json_add UnguardedLender "$UL"
else
  echo "--- skip swap/lender consumers (TOKEN_USDC/TOKEN_HIMS/FEED_HIMS not set)"
fi

if [ -n "${TOKEN_USDC:-}" ] && [ -n "${FEE_TOKEN:-}" ]; then
  # GuardedSettlementRouter takes (tokens[], pegAdapter, clock, fedAnchor, policy, toleranceBps, keeper).
  # For testnet we reuse the ReferenceFeedAdapter as the peg adapter when set.
  PEG_ADAPTER="${PEG_ADAPTER:-}"
  if [ -z "$PEG_ADAPTER" ] && [ -n "${REF:-}" ]; then PEG_ADAPTER="$REF"; fi
  if [ -n "$PEG_ADAPTER" ]; then
    GSR2=$(deploy "GuardedSettlementRouter" \
      "src/consumers/GuardedSettlementRouter.sol:GuardedSettlementRouter" \
      "[$TOKEN_USDC,$FEE_TOKEN]" "$PEG_ADAPTER" "$CLOCK" 1 "${POLICY:-${DEPLOYER}}" 30 "${DEPLOYER}")
    json_add GuardedSettlementRouter "$GSR2"
  else
    echo "--- skip GuardedSettlementRouter (PEG_ADAPTER not set)"
  fi
  USR2=$(deploy "UnguardedSettlementRouter" \
    "src/consumers/GuardedSettlementRouter.sol:UnguardedSettlementRouter")
  json_add UnguardedSettlementRouter "$USR2"
  BILL=$(deploy "ProtectionBilling" \
    "src/consumers/GuardedSettlementRouter.sol:ProtectionBilling" \
    "$FEE_TOKEN" "${DEPLOYER}" "${DEPLOYER}")
  json_add ProtectionBilling "$BILL"
else
  echo "--- skip settlement/billing consumers (TOKEN_USDC/FEE_TOKEN not set)"
fi

echo "=== done. addresses in ${OUT}"
json_write
cat "$OUT"
