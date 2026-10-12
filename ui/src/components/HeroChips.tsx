"use client";

import { StatusDot, type DotTone } from "./StatusDot";
import { CHAINS } from "@/data/chains";
import { indexerAgeSec, useIndexer, useNow } from "@/lib/live";
import { fmtDuration } from "@/lib/format";
import { LATE_AFTER_SEC } from "@/lib/config";

/**
 * "Live on three testnets:" chips. Each dot combines the chain's healthy flag
 * with the age of the indexer snapshot: green only when healthy and the
 * snapshot is 150 s old or less; amber when healthy but older; red when down;
 * grey with no data.
 */
export function HeroChips() {
  const indexer = useIndexer();
  const now = useNow();
  const age = indexerAgeSec(indexer, now);
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Live on three testnets">
      {CHAINS.map((c) => {
        const chain = indexer.data?.chains[c.id];
        let tone: DotTone = "none";
        let said = "no reading yet";
        if (chain && age !== null) {
          if (!chain.healthy) {
            tone = "down";
            said = "down";
          } else if (age > LATE_AFTER_SEC) {
            tone = "late";
            said = `reporting late (snapshot ${fmtDuration(age)} old)`;
          } else {
            tone = "ok";
            said = "reporting";
          }
        }
        return (
          <li
            key={c.id}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-ink-3 px-3 font-mono text-[12.5px] [font-stretch:87.5%]"
          >
            <StatusDot tone={tone} />
            <span>
              {c.name}
              <span className="sr-only">, {said}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
