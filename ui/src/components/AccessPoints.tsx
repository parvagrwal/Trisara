"use client";

import { CommandBlock } from "./CommandBlock";
import { CHAINS, chainInfo, coreAddress } from "@/data/chains";
import { COLOSSEUM_URL, INDEXER_STATE_URL, REPO_URL, SIGNAL_STATE_URL } from "@/lib/config";
import { setActiveChain, useActiveChain } from "@/lib/ui";
import { chipBase } from "@/lib/styles";

const SOLIDITY = `(Rulebook.Action a, uint256 param, bytes32 why) =
    rulebook.decision(bytes32(0), Rulebook.ActionClass.SWAP);
(, int256 answer,,,) = AggregatorV3Interface(guardedFeed).latestRoundData(); // reverts when halted`;

/** Three ways in: from a contract, from a terminal, over HTTP. */
export function AccessPoints() {
  const active = useActiveChain();
  const info = chainInfo(active) ?? CHAINS[0]!;
  const clock = coreAddress(info.id, "AnchorClock") ?? "";
  const castCmd = `cast call \\\n  ${clock} \\\n  "isOpen(uint8,uint256)(bool)" 0 $(date +%s) \\\n  --rpc-url ${info.rpc}`;
  return (
    <div className="mt-10 space-y-8">
      <div className="grid gap-8 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 space-y-3">
          <h3>In your contracts.</h3>
          <p className="text-ink-2">
            Ask the Rulebook what a venue committed to, or swap one address and keep Chainlink&apos;s interface.
          </p>
          <CommandBlock code={SOLIDITY} label="the Solidity snippet" lang="solidity" stack />
        </div>
        <div className="min-w-0 space-y-3">
          <h3>In the terminal.</h3>
          <p className="text-ink-2">Read the clock from any chain with Foundry.</p>
          <div role="group" aria-label="Chain for the cast command" className="flex flex-wrap gap-1.5">
            {CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={active === c.id}
                onClick={() => setActiveChain(c.id)}
                className={`${chipBase} ${active === c.id ? "border-ink bg-ink text-fanfold" : "border-ink-3 text-ink hover:bg-bar"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <CommandBlock code={castCmd} label={`the isOpen command for ${info.name}`} stack />
        </div>
        <div className="min-w-0 space-y-3">
          <h3>Over HTTP.</h3>
          <p className="text-ink-2">No keys, no signup, CORS open.</p>
          <CommandBlock code={`curl -s ${INDEXER_STATE_URL}\ncurl -s ${SIGNAL_STATE_URL}`} label="the two curl commands" stack />
        </div>
      </div>
      <p className="text-ink-2">
        Built for <a href={COLOSSEUM_URL}>Colosseum Crypto World&apos;s Fair</a> on the Tempo, Hyperliquid and Robinhood Chain
        tracks. <a href={REPO_URL}>MIT licensed</a>.
      </p>
    </div>
  );
}
