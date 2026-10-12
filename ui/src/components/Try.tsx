"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CommandBlock } from "./CommandBlock";
import { Deployments } from "./Deployments";
import { RegionBoundary } from "./RegionBoundary";
import { CHAINS, MAINNET_FEEDS, MAINNET_RPC, consumerAddress, coreAddress, type ChainInfo } from "@/data/chains";
import { INDEXER_URL } from "@/lib/config";
import { useIndexer, useSignal } from "@/lib/live";
import { fmtPriceFull, fmtUtc, reasonBytes32, unixMs } from "@/lib/format";
import { signalsFor } from "@/lib/normalize";
import { actionIndex, isRuleOk } from "@/lib/types";

const WILDCARD = `0x${"0".repeat(64)}`;

function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5ch_minmax(0,1fr)] gap-x-4 border-t border-rule pt-5">
      <span aria-hidden="true" className="font-mono text-[19px] font-semibold text-ink-3 tnum">
        {n}
      </span>
      <div className="min-w-0 space-y-3">
        <h3 className="text-[17px]">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

function LastSaw({ chain }: { chain: ChainInfo }) {
  const indexer = useIndexer();
  const c = indexer.data?.chains[chain.id];
  if (!indexer.data) return <>The indexer isn&apos;t reporting right now.</>;
  if (!c || !c.healthy || !c.clock) return <>The indexer couldn&apos;t read {chain.name} in its last snapshot.</>;
  const bts = unixMs(c.blockTimestamp);
  const at = unixMs(c.clock.at);
  return (
    <>
      The indexer last saw <code className="data font-semibold">{String(c.clock.open)}</code> for the equities anchor,{" "}
      {bts !== null ? <>at chain time {fmtUtc(bts)}</> : <>read at {at !== null ? fmtUtc(at) : "an unknown time"}</>}.
    </>
  );
}

function LastSawRule({ chain }: { chain: ChainInfo }) {
  const indexer = useIndexer();
  const c = indexer.data?.chains[chain.id];
  if (!indexer.data) return <>The indexer isn&apos;t reporting right now.</>;
  const r = c?.rules?.SWAP;
  if (!c || !c.healthy || !r) return <>The indexer couldn&apos;t read {chain.name} in its last snapshot.</>;
  if (!isRuleOk(r)) return <>The indexer&apos;s last read of SWAP on {chain.name} failed: {r.error}</>;
  return (
    <>
      The indexer last saw{" "}
      <code className="data font-semibold">
        {r.action} {r.param} {r.reason}
      </code>{" "}
      for SWAP. cast prints that as <code className="data">{actionIndex(r.action)}</code>,{" "}
      <code className="data">{r.param}</code> and <code className="data break-all">{reasonBytes32(r.reason)}</code>.
    </>
  );
}

function LastSawPrice() {
  const signal = useSignal();
  const aapl = signalsFor(signal.data, "46630").find((s) => s.feed === "AAPL") ?? signal.data?.signals.find((s) => s.feed === "AAPL");
  if (!signal.data) return <>The Signal API isn&apos;t reporting right now.</>;
  if (!aapl?.lastLivePrint) return <>The Signal API&apos;s last AAPL read failed{aapl?.note ? `: ${aapl.note}` : ""}.</>;
  return (
    <>
      The Signal API last saw <code className="data font-semibold">{fmtPriceFull(aapl.lastLivePrint.price)}</code> updated{" "}
      {fmtUtc(Date.parse(aapl.lastLivePrint.updatedAt))}.
    </>
  );
}

function Commands({ chain }: { chain: ChainInfo }) {
  const clock = coreAddress(chain.id, "AnchorClock") ?? "";
  const rulebook = coreAddress(chain.id, "Rulebook") ?? "";
  const rpc = chain.rpc;
  const lender = consumerAddress("GuardedLender") ?? "";
  const swap = consumerAddress("GuardedSwapRouter") ?? "";
  const gfeed = consumerAddress("GuardedFeed") ?? "";
  const mainnetCurl = `curl -s ${MAINNET_RPC} -H 'content-type: application/json' -H 'user-agent: Mozilla/5.0' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${MAINNET_FEEDS.AAPL}","data":"0xfeaf968c"},"latest"]}'`;
  return (
    <ol className="space-y-8">
      <Step n={1} title="Install Foundry once.">
        <CommandBlock code={"curl -L https://foundry.paradigm.xyz | bash\nfoundryup"} label="the Foundry install commands" />
      </Step>
      <Step n={2} title="Ask the chain whether the market is open.">
        <p className="prose-col text-ink-2">
          <code className="data">0</code> is the US equities anchor; <code className="data">1</code> is the Fed anchor that the
          settlement router uses.
        </p>
        <CommandBlock
          code={`cast call ${clock} "isOpen(uint8,uint256)(bool)" 0 $(date +%s) --rpc-url ${rpc}\ncast call ${clock} "isOpen(uint8,uint256)(bool)" 1 $(date +%s) --rpc-url ${rpc}   # the Fed anchor`}
          label={`the isOpen commands for ${chain.name}`}
          footer={<LastSaw chain={chain} />}
        />
        <p className="text-[14px] text-ink-2">There is no &ldquo;last saw&rdquo; line for the Fed anchor: nothing indexes it.</p>
      </Step>
      <Step n={3} title="Read what the venue committed to for swaps.">
        <p className="prose-col text-ink-2">
          Returns <code className="data">(action, param, reason)</code>. Actions: 0 ALLOW, 1 CAP, 2 COLLAR, 3 DEFER, 4 HALT.
          Classes: 0 SWAP, 1 BORROW, 2 LIQUIDATE, 3 SETTLE, 4 EXIT.
        </p>
        <CommandBlock
          code={`cast call ${rulebook} "decision(bytes32,uint8)(uint8,uint256,bytes32)" ${WILDCARD} 0 --rpc-url ${rpc}\ncast to-ascii <the bytes32 it printed>`}
          label={`the Rulebook decision command for ${chain.name}`}
          footer={<LastSawRule chain={chain} />}
        />
      </Step>
      <Step n={4} title="Read a live Chainlink print.">
        <p className="prose-col text-ink-2">
          Equity feeds live on Robinhood Chain mainnet. The public RPC sits behind a firewall that rejects some TLS clients,
          so this uses <code className="data">curl</code> with a browser user-agent. AAPL is shown; TSLA is{" "}
          <code className="data break-all">{MAINNET_FEEDS.TSLA}</code> and NVDA is{" "}
          <code className="data break-all">{MAINNET_FEEDS.NVDA}</code>.
        </p>
        <CommandBlock code={mainnetCurl} label="the mainnet AAPL feed read" footer={<LastSawPrice />} />
        <p className="prose-col text-[14px] text-ink-2">
          The result is five 32-byte words: the second is the price with 8 decimals, the fourth is the update timestamp.
        </p>
      </Step>
      <Step n={5} title="Read the guards off the consumer contracts.">
        {chain.id === "46630" ? (
          <>
            <CommandBlock
              code={`cast call ${lender} "OPEN_LTV_BPS()(uint256)" --rpc-url ${rpc}   # expect 5000\ncast call ${lender} "CLOSED_LTV_BPS()(uint256)" --rpc-url ${rpc} # expect 3500\ncast call ${swap} "guardedFeed()(address)" --rpc-url ${rpc} # expect ${gfeed}`}
              label="the consumer contract reads"
            />
            <p className="prose-col text-[14px] text-ink-2">
              The last line is how you check the README&apos;s claim that the swap router reads the guarded feed. This page
              doesn&apos;t mark it verified: that check is yours.
            </p>
          </>
        ) : (
          <p className="prose-col text-ink-2">
            The consumer contracts are deployed on Robinhood Chain testnet only. Switch to the Robinhood Chain tab for these
            commands.
          </p>
        )}
      </Step>
      <Step n={6} title="Or skip Foundry.">
        <CommandBlock code={`curl -s ${INDEXER_URL}/state | jq '.chains["${chain.id}"]'`} label={`the indexer command for ${chain.name}`} />
      </Step>
    </ol>
  );
}

export function Try() {
  const [active, setActive] = useState(CHAINS[0]!.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const chain = CHAINS.find((c) => c.id === active) ?? CHAINS[0]!;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = CHAINS.findIndex((c) => c.id === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % CHAINS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + CHAINS.length) % CHAINS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = CHAINS.length - 1;
    else return;
    e.preventDefault();
    const id = CHAINS[next]!.id;
    setActive(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="space-y-8">
      <div role="tablist" aria-label="Chain for the commands" className="flex gap-1 overflow-x-auto border-b border-ink">
        {CHAINS.map((c) => (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[c.id] = el;
            }}
            id={`try-tab-${c.id}`}
            role="tab"
            type="button"
            aria-selected={active === c.id}
            aria-controls="try-panel"
            tabIndex={active === c.id ? 0 : -1}
            onClick={() => setActive(c.id)}
            onKeyDown={onKey}
            className={`tap min-h-11 shrink-0 whitespace-nowrap border-b-[3px] px-4 font-mono text-[13px] [font-stretch:87.5%] ${
              active === c.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {c.name} <span className="text-ink-2">{c.id}</span>
          </button>
        ))}
      </div>
      <div id="try-panel" role="tabpanel" aria-labelledby={`try-tab-${active}`}>
        <RegionBoundary name="commands">
          <Commands chain={chain} />
        </RegionBoundary>
      </div>
      <Deployments />
    </div>
  );
}
