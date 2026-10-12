"use client";

import { CHAINS, chainName } from "@/data/chains";
import { plainEnglish } from "@/lib/format";
import { setActiveChain, useActiveChain } from "@/lib/ui";
import { CLASSES, type IndexerState } from "@/lib/types";
import { chipBase } from "@/lib/styles";

/** One generated sentence per action class for the selected chain. */
export function PlainEnglish({ data }: { data: IndexerState }) {
  const active = useActiveChain();
  const chain = data.chains[active];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-platen-dim [font-stretch:87.5%]">In plain English, for</span>
        <div role="group" aria-label="Chain for the plain-English rules" className="flex flex-wrap gap-1.5">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={active === c.id}
              onClick={() => setActiveChain(c.id)}
              className={`${chipBase} ${active === c.id ? "border-platen-text bg-platen-text text-platen" : "border-platen-rule text-platen-text hover:border-platen-dim"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {!chain ? (
        <p className="text-[14px] text-platen-dim">{chainName(active)} is not in this snapshot.</p>
      ) : !chain.healthy || !chain.rules ? (
        <p className="text-[14px] text-platen-dim">
          The indexer can&apos;t read {chainName(active)} right now, so there are no rules to state.
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 text-[15px] text-platen-text sm:grid-cols-2">
          {CLASSES.map((cls) => (
            <li key={cls}>{plainEnglish(cls, chain.rules?.[cls])}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
