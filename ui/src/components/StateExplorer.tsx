"use client";

import { useEffect, useState } from "react";
import { CheckGlyph } from "./Glyphs";
import { useReducedMotion } from "@/lib/ui";

// Reference behaviour from src/PriceIntegrity.sol, src/GuardedFeed.sol and the
// consumers. Not live state.

const STATES = ["OPEN", "CLOSED", "REOPENING", "STALE", "DISLOCATED", "HALTED", "CHAIN_DEGRADED"] as const;
type PIState = (typeof STATES)[number];

const LADDER = [
  { step: "halt flag", test: "the venue halted the asset", yields: "HALTED" },
  { step: "chain degraded", test: "the venue feed pipeline is degraded", yields: "CHAIN_DEGRADED" },
  { step: "zero price", test: "the reference or the feed price is 0", yields: "DISLOCATED" },
  { step: "clock regime", test: "the anchor is closed, or opened within reopenGrace", yields: "CLOSED or REOPENING" },
  { step: "freshness", test: "the reference is older than maxFreshness", yields: "STALE" },
  { step: "velocity", test: "the reference moved more than velocityBps inside velocityWindow", yields: "DISLOCATED" },
  { step: "deviation", test: "the feed is more than deviationBps from the reference", yields: "DISLOCATED" },
  { step: "open", test: "every check passed", yields: "OPEN" },
] as const;

/** Index of the decisive ladder step per state. DISLOCATED shows deviation; zero price and velocity yield it too. */
const DECISIVE: Record<PIState, number> = {
  HALTED: 0,
  CHAIN_DEGRADED: 1,
  CLOSED: 3,
  REOPENING: 3,
  STALE: 4,
  DISLOCATED: 6,
  OPEN: 7,
};

const RESULT: Record<PIState, [string, string]> = {
  OPEN: ["the underlying print, untouched", "swaps fill inside the collar; lender LTV 50%; liquidation allowed on the reference feed after any grace"],
  CLOSED: ["the last open print", "lender LTV 35% and no liquidation; Rulebook rules for the closed session apply for venues that query them"],
  REOPENING: ["the last open print", "liquidation waits out the lender's grace window"],
  STALE: ["reverts", "swap refunds instantly"],
  DISLOCATED: ["the print clamped to last open ± collarBps", "swap router escrows if the price sits outside its collar"],
  HALTED: ["reverts", "swap refunds instantly"],
  CHAIN_DEGRADED: ["reverts", "swap refunds instantly"],
};

function ResultRow({ s, highlight }: { s: PIState; highlight?: boolean }) {
  return (
    <tr className={`border-t border-rule align-top ${highlight ? "bg-bar" : ""}`}>
      <th scope="row" className="data py-2 pr-3 text-left font-semibold">
        {s}
      </th>
      <td className="py-2 pr-3 text-[14px]">{RESULT[s][0]}</td>
      <td className="py-2 text-[14px]">{RESULT[s][1]}</td>
    </tr>
  );
}

export function StateExplorer({ liveState, chainLabel }: { liveState: "OPEN" | "CLOSED" | null; chainLabel: string }) {
  const reduced = useReducedMotion();
  const [picked, setPicked] = useState<PIState | null>(null);
  const selected: PIState = picked ?? liveState ?? "OPEN";
  const decisive = DECISIVE[selected];
  const [step, setStep] = useState(-1);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced) {
      timers.push(setTimeout(() => setStep(decisive), 0));
    } else {
      for (let i = 0; i <= decisive; i++) timers.push(setTimeout(() => setStep(i), 40 + i * 130));
    }
    return () => timers.forEach(clearTimeout);
  }, [selected, decisive, reduced]);

  return (
    <section aria-labelledby="explorer-title" className="space-y-4">
      <div>
        <h4 id="explorer-title" className="font-mono text-[15px] font-semibold">
          State explorer
        </h4>
        <p className="text-[14px] text-ink-2">Reference behaviour from the contracts, not live state.</p>
      </div>
      <div role="group" aria-label="PriceIntegrity state" className="flex flex-wrap gap-1.5">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={selected === s}
            onClick={() => {
              setStep(-1);
              setPicked(s);
            }}
            className={`tap inline-flex h-8 items-center gap-2 rounded-full border px-3 font-mono text-[12px] [font-stretch:87.5%] ${
              selected === s ? "border-ink bg-ink text-fanfold" : "border-ink-3 text-ink hover:bg-bar"
            }`}
          >
            {s}
            {liveState === s ? (
              <span className={`text-[11px] ${selected === s ? "text-bar" : "text-ink-2"}`}>matches the live clock on {chainLabel}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <ol aria-label={`Evaluation ladder for ${selected}`} className="data space-y-0.5">
          {LADDER.map((l, i) => {
            const state = step < 0 ? "pending" : i < Math.min(step, decisive) ? "passed" : i === decisive && step >= decisive ? "decisive" : i > decisive ? "skipped" : "pending";
            return (
              <li
                key={l.step}
                className={`grid grid-cols-[1.5rem_1fr] items-start gap-x-2 border-l-2 px-2 py-1 ${
                  state === "decisive" ? "border-ink bg-bar text-ink" : state === "passed" ? "border-rule text-ink" : "border-rule text-ink-3"
                }`}
              >
                <span aria-hidden="true" className="pt-0.5 tnum">
                  {state === "passed" ? <CheckGlyph size={11} /> : state === "decisive" ? "▶" : String(i + 1)}
                </span>
                <span>
                  <span className="font-semibold">{l.step}</span>
                  <span className={state === "decisive" ? "text-ink-2" : ""}>: {l.test}</span>
                  {state === "decisive" ? (
                    <span className="block font-semibold">
                      {i === 3 ? selected : l.yields}
                      {selected === "DISLOCATED" ? <span className="font-normal text-ink-2"> (zero price and velocity also yield it)</span> : null}
                    </span>
                  ) : null}
                  <span className="sr-only">{state === "passed" ? ", passed" : state === "decisive" ? ", decides" : state === "skipped" ? ", not reached" : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="min-w-0 space-y-3">
          <table className="w-full">
            <caption className="sr-only">What GuardedFeed and the routers do in each PriceIntegrity state</caption>
            <thead>
              <tr className="text-left font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">
                <th scope="col" className="pb-1 pr-3 font-normal">state</th>
                <th scope="col" className="pb-1 pr-3 font-normal">GuardedFeed returns</th>
                <th scope="col" className="pb-1 font-normal">Router behaviour</th>
              </tr>
            </thead>
            <tbody>
              {showAll ? STATES.map((s) => <ResultRow key={s} s={s} highlight={s === selected} />) : <ResultRow s={selected} />}
            </tbody>
          </table>
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="tap font-mono text-[12px] text-ribbon underline underline-offset-4 [font-stretch:87.5%]"
          >
            {showAll ? "show the selected state only" : "show all states"}
          </button>
        </div>
      </div>
    </section>
  );
}
