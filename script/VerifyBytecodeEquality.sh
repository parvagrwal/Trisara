#!/usr/bin/env bash
# Trisara bytecode-equality proof — Day 6.
# Verifies that the core contracts deployed on the three testnets are
# byte-identical (same keccak256 of runtime code) where expected.
#
# Expected results:
#   AnchorClock    — IDENTICAL on all 3 (no immutables)
#   Rulebook       — IDENTICAL on all 3 (same deployer = same immutables)
#   LivenessAdapter— IDENTICAL on all 3 (same maxGap = 300)
#   PriceIntegrity — DIFFERS by design (clock address + anchor are immutables)
#
# Usage: bash script/VerifyBytecodeEquality.sh
set -euo pipefail

RH="https://rpc.testnet.chain.robinhood.com"
HL="https://rpc.hyperliquid-testnet.xyz/evm"
TE="https://rpc.testnet.tempo.xyz"

codehash() { # rpc address — prints keccak256 of runtime code
  local code
  code=$(cast code --rpc-url "$1" "$2" 2>/dev/null)
  if [ -z "$code" ] || [ "$code" = "0x" ]; then echo "NO_CODE"; return 1; fi
  echo -n "$code" | cast keccak 2>/dev/null
}

check_equal() { # label expected-identical rpc1 addr1 rpc2 addr2 rpc3 addr3
  local label="$1"; shift
  local h1 h2 h3
  h1=$(codehash "$1" "$2") || { echo "FAIL $label: no code on chain 1"; return 1; }
  h2=$(codehash "$3" "$4") || { echo "FAIL $label: no code on chain 2"; return 1; }
  h3=$(codehash "$5" "$6") || { echo "FAIL $label: no code on chain 3"; return 1; }
  if [ "$h1" = "$h2" ] && [ "$h2" = "$h3" ]; then
    echo "PASS $label identical: $h1"
  else
    echo "FAIL $label differs:"
    echo "  chain1: $h1"
    echo "  chain2: $h2"
    echo "  chain3: $h3"
    return 1
  fi
}

echo "--- Trisara bytecode equality (testnets) ---"
check_equal "AnchorClock" \
  "$RH" 0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6 \
  "$HL" 0xC2529BD7e5C8038516908189A142070953b7ad2e \
  "$TE" 0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA

check_equal "Rulebook" \
  "$RH" 0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC \
  "$HL" 0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b \
  "$TE" 0x713420180cec1E1EF394fb9e2606e0bd14764014

check_equal "LivenessAdapter" \
  "$RH" 0xA206cDd55845A2e0B13c9a18248c4768b4316326 \
  "$HL" 0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC \
  "$TE" 0xA2756A19158EdCfdF6Cb16A6f616E2cE0104386D

echo "--- PriceIntegrity (expected to differ: clock + anchor immutables) ---"
echo "RH: $(codehash "$RH" 0x8bC2D43D3112AdE6460685295A70bF7C31E68B5A)"
echo "HL: $(codehash "$HL" 0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6)"
echo "TE: $(codehash "$TE" 0x46E1d6DF88D19aFCcF70113471CA55F6Ccb05818)"
echo "--- done ---"
