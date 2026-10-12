#!/usr/bin/env bash
# Full Trisara stack on Robinhood testnet 46630.
# Chainlink feeds are mainnet-only, so we deploy our own mock feeds
# (standard practice on this testnet) and wire the real TSLA + rUSDG tokens.
#
# Real testnet addresses (verified Oct 9):
#   TSLA  0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E (18 dec)
#   rUSDG 0x7C902600cb5bf24225DF1a77b333D84e03C1F210 (6 dec)
# Core (already deployed Oct 9):
#   AnchorClock    0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6
#   Rulebook       0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC
#   PriceIntegrity 0x8bC2D43D3112AdE6460685295A70bF7C31E68B5A
#   LivenessAdapter 0xA206cDd55845A2e0B13c9a18248c4768b4316326
#
# Usage: PRIVATE_KEY, DEPLOYER set; RPC_URL defaults to RH testnet.
# Writes deployments/46630-full.json
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${DEPLOYER:?set DEPLOYER}"
RPC_URL="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
GAS_LIMIT="${GAS_LIMIT:-3000000}"
OUT="deployments/46630-full.json"
mkdir -p deployments

TSLA=0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E
RUSDG=0x7C902600cb5bf24225DF1a77b333D84e03C1F210
CLOCK=0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6
INTEGRITY=0x8bC2D43D3112AdE6460685295A70bF7C31E68B5A

# 8-dec feed prices (TSLA ~$387.05 Oct 9)
PX_TSLA_PER_RUSDG=258363        # 1 rUSDG = 0.00258363 TSLA
PX_RUSDG_PER_TSLA=38705000000   # 1 TSLA = 387.05 rUSDG
PX_PEG=100000000                # rUSDG/USD = 1.00

echo "Deploying full stack to 46630 via ${RPC_URL}"

deploy() {
  local name="$1" target="$2"; shift 2
  echo "--- ${name}" >&2
  local addr
  if [ $# -gt 0 ]; then
    addr=$(forge create --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --gas-limit "$GAS_LIMIT" "$target" --constructor-args "$@" 2>&1 \
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

JSON_ENTRIES=""
jadd() {
  if [ -z "$JSON_ENTRIES" ]; then JSON_ENTRIES="  \"$1\": \"$2\"";
  else JSON_ENTRIES="${JSON_ENTRIES},
  \"$1\": \"$2\""; fi
}

# ---- mock feeds (Chainlink feeds are mainnet-only) ----
SWAPFEED=$(deploy "MockAggregator TSLA/rUSDG" "src/testnet/MockAggregator.sol:MockAggregator" 8 $PX_TSLA_PER_RUSDG)
jadd mockFeedTslaPerRusdg "$SWAPFEED"
LENDFEED=$(deploy "MockAggregator rUSDG/TSLA" "src/testnet/MockAggregator.sol:MockAggregator" 8 $PX_RUSDG_PER_TSLA)
jadd mockFeedRusdgPerTsla "$LENDFEED"
PEGFEED=$(deploy "MockAggregator rUSDG/USD" "src/testnet/MockAggregator.sol:MockAggregator" 8 $PX_PEG)
jadd mockFeedPeg "$PEGFEED"

MUSD=$(deploy "MockStable mUSD" "src/testnet/MockStable.sol:MockStable" 6)
jadd mockUSD "$MUSD"
POLICY=$(deploy "AllowAllPolicy" "src/testnet/AllowAllPolicy.sol:AllowAllPolicy")
jadd policy "$POLICY"

# ---- adapters ----
SWAPAD=$(deploy "ReferenceFeedAdapter (swap)" \
  "src/adapters/ReferenceFeedAdapter.sol:ReferenceFeedAdapter" "$SWAPFEED" 900)
jadd refAdapterSwap "$SWAPAD"
LENDAD=$(deploy "ReferenceFeedAdapter (lend)" \
  "src/adapters/ReferenceFeedAdapter.sol:ReferenceFeedAdapter" "$LENDFEED" 900)
jadd refAdapterLend "$LENDAD"
PEGAD=$(deploy "ReferenceFeedAdapter (peg)" \
  "src/adapters/ReferenceFeedAdapter.sol:ReferenceFeedAdapter" "$PEGFEED" 900)
jadd refAdapterPeg "$PEGAD"

GF=$(deploy "GuardedFeed" "src/GuardedFeed.sol:GuardedFeed" \
  "$SWAPFEED" "$INTEGRITY" "$DEPLOYER" 500)
jadd GuardedFeed "$GF"

# ---- swap ----
GSR=$(deploy "GuardedSwapRouter" \
  "src/consumers/GuardedSwapRouter.sol:GuardedSwapRouter" \
  "$GF" "$RUSDG" "$TSLA" 500 "$DEPLOYER" $PX_TSLA_PER_RUSDG)
jadd GuardedSwapRouter "$GSR"
USR=$(deploy "UnguardedSwapRouter" \
  "src/consumers/GuardedSwapRouter.sol:UnguardedSwapRouter" \
  "$SWAPFEED" "$RUSDG" "$TSLA")
jadd UnguardedSwapRouter "$USR"

# ---- lender (collateral TSLA, debt rUSDG) ----
GL=$(deploy "GuardedLender" \
  "src/consumers/GuardedLender.sol:GuardedLender" \
  "$TSLA" "$RUSDG" "$CLOCK" 0 "$LENDAD" "$LENDAD" 900 0)
jadd GuardedLender "$GL"
UL=$(deploy "UnguardedLender" \
  "src/consumers/GuardedLender.sol:UnguardedLender" \
  "$TSLA" "$RUSDG" "$LENDAD")
jadd UnguardedLender "$UL"

# ---- settlement + billing ----
GS=$(deploy "GuardedSettlementRouter" \
  "src/consumers/GuardedSettlementRouter.sol:GuardedSettlementRouter" \
  "[$RUSDG,$MUSD]" "$PEGAD" "$CLOCK" 1 "$POLICY" 30 "$DEPLOYER")
jadd GuardedSettlementRouter "$GS"
US=$(deploy "UnguardedSettlementRouter" \
  "src/consumers/GuardedSettlementRouter.sol:UnguardedSettlementRouter")
jadd UnguardedSettlementRouter "$US"
BILL=$(deploy "ProtectionBilling" \
  "src/consumers/GuardedSettlementRouter.sol:ProtectionBilling" \
  "$RUSDG" "$DEPLOYER" "$DEPLOYER")
jadd ProtectionBilling "$BILL"

printf "{\n%s\n}\n" "$JSON_ENTRIES" > "$OUT"
echo "=== done. addresses in ${OUT}"
cat "$OUT"
echo
echo "NEXT: fund from the testnet faucet (https://faucet.testnet.chain.robinhood.com):"
echo "  - rUSDG + TSLA to $DEPLOYER (router/lender inventory)"
echo "  - then: cast send \$MUSD \"mint(address,uint256)\" $DEPLOYER 1000000000000 --rpc-url $RPC_URL --private-key \$PRIVATE_KEY"
