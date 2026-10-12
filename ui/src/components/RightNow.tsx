"use client";

import { CHAINS } from "@/data/chains";
import { indexerAgeSec, signalAgeSec, useIndexer, useNow, useSignal } from "@/lib/live";
import { bpsFixed, fmtDuration, fmtSpan } from "@/lib/format";
import { STALLED_AFTER_SEC } from "@/lib/config";
import { isRuleOk, type Rule } from "@/lib/types";

// "Right now:" sentences. Built from live data and omitted entirely (never a
// placeholder) when the source has no data.

/** Is it live? */
export function RightNowAges() {
  const indexer = useIndexer();
  const signal = useSignal();
  const now = useNow();
  const iAge = indexerAgeSec(indexer, now);
  const sAge = signalAgeSec(signal, now);
  const parts: string[] = [];
  if (iAge !== null) {
    parts.push(
      `the indexer's snapshot is ${fmtDuration(iAge)} old${iAge > STALLED_AFTER_SEC ? ", so its poller may be down" : ""}`,
    );
  }
  if (sAge !== null) parts.push(`the Signal API last polled ${fmtDuration(sAge)} ago`);
  if (!parts.length) return null;
  return <> Right now: {parts.join(" and ")}.</>;
}

function ruleWords(r: Rule | undefined): string | null {
  if (!isRuleOk(r)) return null;
  const n = /^\d+$/.test(r.param) ? Number(r.param) : null;
  if (r.action === "COLLAR" && n !== null) return `COLLAR ±${bpsFixed(n)}%`;
  if (r.action === "CAP" && n !== null) return `CAP max ${bpsFixed(n)}%`;
  if (r.action === "DEFER" && n !== null) return `DEFER for ${fmtSpan(n)}`;
  if (r.action === "HALT") return `HALT (${r.reason || "no reason"})`;
  return r.action;
}

const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** What happens when the market closes? */
export function RightNowRules() {
  const indexer = useIndexer();
  if (!indexer.data) return null;
  const readings = CHAINS.map((c) => {
    const chain = indexer.data!.chains[c.id];
    const swap = chain?.healthy ? ruleWords(chain.rules?.SWAP) : null;
    const liq = chain?.healthy ? ruleWords(chain.rules?.LIQUIDATE) : null;
    return { name: c.name, swap, liq, ok: swap !== null && liq !== null };
  });
  const ok = readings.filter((r) => r.ok);
  const missing = readings.filter((r) => !r.ok).map((r) => r.name);
  if (!ok.length) return null;
  const same = ok.every((r) => r.swap === ok[0]!.swap && r.liq === ok[0]!.liq);
  const tail = missing.length ? ` (${listNames(missing)} ${missing.length === 1 ? "isn't" : "aren't"} reporting)` : "";
  if (same) {
    const where = ok.length === CHAINS.length ? "on all three chains" : `on ${listNames(ok.map((r) => r.name))}`;
    return (
      <>
        {" "}
        Right now: SWAP is {ok[0]!.swap} and LIQUIDATE is {ok[0]!.liq} {where}
        {tail}.
      </>
    );
  }
  return (
    <>
      {" "}
      Right now: {ok.map((r) => `on ${r.name}, SWAP is ${r.swap} and LIQUIDATE is ${r.liq}`).join("; ")}
      {tail}.
    </>
  );
}
