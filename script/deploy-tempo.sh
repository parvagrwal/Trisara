#!/usr/bin/env bash
# Tempo Moderato (42431) core deploy via `cast send --create`.
# forge create's gas handling breaks on Tempo (S8 lesson); cast works.
# Usage: PRIVATE_KEY, DEPLOYER, RPC_URL set (ANCHOR=1 for BANK_US).
set -euo pipefail

: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${DEPLOYER:?set DEPLOYER}"
: "${RPC_URL:?set RPC_URL}"
ANCHOR="${ANCHOR:-1}"

echo "Deploying core to Tempo 42431 (anchor=${ANCHOR})"

csend() { # name file contract sig [args...]
  local name="$1" file="$2" contract="$3" sig="$4"; shift 4
  echo "--- ${name}" >&2
  local code enc payload addr
  code=$(forge inspect "${file}:${contract}" bytecode)
  if [ $# -gt 0 ]; then
    enc=$(cast abi-encode "$sig" "$@")
    payload="${code}${enc#0x}"
  else
    payload="$code"
  fi
  addr=$(cast send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
    --create "$payload" 2>&1 | grep -oE "contractAddress.*0x[0-9a-fA-F]{40}" \
    | grep -oE "0x[0-9a-fA-F]{40}" | head -1)
  if [ -z "$addr" ]; then echo "FAILED: ${name}" >&2; exit 1; fi
  echo "${name} -> ${addr}" >&2
  printf "%s" "$addr"
}

OUT="deployments/42431.json"
mkdir -p deployments
JSON_ENTRIES=""

jadd() {
  if [ -z "$JSON_ENTRIES" ]; then JSON_ENTRIES="  \"$1\": \"$2\"";
  else JSON_ENTRIES="${JSON_ENTRIES},
  \"$1\": \"$2\""; fi
}

CLOCK=$(csend "AnchorClock" "src/AnchorClock.sol" "AnchorClock" "")
jadd AnchorClock "$CLOCK"

# NOTE: cast send --create output parsing differs by version; if the address
# line is missed, find it via: cast receipt <txhash> --rpc-url $RPC_URL
RB=$(csend "Rulebook" "src/Rulebook.sol" "Rulebook" \
  "f(address,address,uint256)" "$DEPLOYER" "$DEPLOYER" 86400)
jadd Rulebook "$RB"

PI=$(csend "PriceIntegrity" "src/PriceIntegrity.sol" "PriceIntegrity" \
  "f(address,uint8,(uint256,uint256,uint256,uint256,uint256))" \
  "$CLOCK" "$ANCHOR" "(500,1000,300,900,900)")
jadd PriceIntegrity "$PI"

LV=$(csend "LivenessAdapter" "src/adapters/LivenessAdapter.sol" "LivenessAdapter" \
  "f(uint256)" 300)
jadd LivenessAdapter "$LV"

printf "{\n%s\n}\n" "$JSON_ENTRIES" > "$OUT"
echo "=== done. addresses in ${OUT}"
cat "$OUT"
