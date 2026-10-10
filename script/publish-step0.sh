#!/usr/bin/env bash
# Trisara Step 0 rulebook publication — Day 6.
# The venue admin pre-commits initial rules on each chain's Rulebook.
# Without published rules, decisions fail closed to HALT — publishing
# the weekend rule BEFORE the weekend is the product.
#
# Step 0 rules (asset = bytes32(0) wildcard):
#   SWAP      -> COLLAR 500bps, persistent
#   BORROW    -> CAP 1000bps, persistent
#   LIQUIDATE -> DEFER 3600s, persistent
#   SETTLE    -> COLLAR 500bps, persistent
#   EXIT      -> always ALLOW (enforced by contract, INV-5)
#
# Usage:
#   export PRIVATE_KEY=0x...   # venue admin key (NEVER commit)
#   bash script/publish-step0.sh
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY}"

RH="https://rpc.testnet.chain.robinhood.com"
HL="https://rpc.hyperliquid-testnet.xyz/evm"
TE="https://rpc.testnet.tempo.xyz"

# Rulebook addresses (testnet)
RH_RB="0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC"
HL_RB="0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b"
TE_RB="0x713420180cec1E1EF394fb9e2606e0bd14764014"

ASSET="0x0000000000000000000000000000000000000000000000000000000000000000"
# reason codes as bytes32
R_STEP0="0x5354455030000000000000000000000000000000000000000000000000000000" # "STEP0"

publish() { # rpc rulebook
  local rpc="$1" rb="$2"
  echo "--- publishing to $rb via $rpc"
  # SWAP=0 -> COLLAR=2, 500bps
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$rb" \
    "setRule(bytes32,uint8,(uint8,uint256,uint64,bytes32))" \
    "$ASSET" 0 "(2,500,0,$R_STEP0)" > /dev/null
  echo "  SWAP -> COLLAR 500"
  # BORROW=1 -> CAP=1, 1000bps
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$rb" \
    "setRule(bytes32,uint8,(uint8,uint256,uint64,bytes32))" \
    "$ASSET" 1 "(1,1000,0,$R_STEP0)" > /dev/null
  echo "  BORROW -> CAP 1000"
  # LIQUIDATE=2 -> DEFER=3, 3600s
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$rb" \
    "setRule(bytes32,uint8,(uint8,uint256,uint64,bytes32))" \
    "$ASSET" 2 "(3,3600,0,$R_STEP0)" > /dev/null
  echo "  LIQUIDATE -> DEFER 3600"
  # SETTLE=3 -> COLLAR=2, 500bps
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$rb" \
    "setRule(bytes32,uint8,(uint8,uint256,uint64,bytes32))" \
    "$ASSET" 3 "(2,500,0,$R_STEP0)" > /dev/null
  echo "  SETTLE -> COLLAR 500"
}

publish "$RH" "$RH_RB"
publish "$HL" "$HL_RB"
publish "$TE" "$TE_RB"

echo "--- Step 0 published on all 3 chains ---"
