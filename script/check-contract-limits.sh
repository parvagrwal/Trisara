#!/usr/bin/env bash
# S6 size gate — run after `forge build`. Fails if any contract > 15KB runtime.
set -euo pipefail
forge build --skip test > /dev/null
fail=0
for name in AnchorClock PriceIntegrity Rulebook GuardedFeed \
            ReferenceFeedAdapter PoolTwapAdapter LivenessAdapter \
            HyperCoreAdapter TempoStableAdapter \
            GuardedSwapRouter GuardedLender GuardedSettlementRouter ProtectionBilling; do
  file=$(ls out/$name.sol/$name.json 2>/dev/null | head -1 || true)
  [ -z "$file" ] && { echo "SKIP: $name (not written yet)"; continue; }
  bytes=$(( ($(jq -r '.deployedBytecode.object | length' "$file") - 2 ) / 2 ))
  kb=$(awk "BEGIN{printf \"%.2f\", $bytes/1024}")
  if [ "$bytes" -gt 15360 ]; then echo "FAIL: $name = ${kb}KB"; fail=1;
  else echo "OK:   $name = ${kb}KB"; fi
done
exit $fail
