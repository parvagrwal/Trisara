"use client";

import { useState, type ReactNode } from "react";
import { ActionChip } from "./ActionChip";
import { Flash } from "./Flash";
import { Gauge } from "./Gauge";
import { Skel } from "./Skeleton";
import { Tip } from "./Tip";
import { CHAINS, chainName } from "@/data/chains";
import { STALE_FEED_SEC } from "@/lib/config";
import { fmtDuration, fmtParam, fmtPrice, fmtPriceFull, fmtUtcTime } from "@/lib/format";
import { signalChains, signalsFor } from "@/lib/normalize";
import { FEEDS, type Signal, type SignalState } from "@/lib/types";
import { chipBase } from "@/lib/styles";

const ONE_CHAIN_TIP =
  "The deployed Signal API still serves one chain. Clock and rules for every chain are in the Session and Rulebook panels.";
const FALLBACK_TIP = "Offchain fallback, not an onchain read: the API couldn't read the contract and used its built-in rule.";
const RESUMES_TIP = "The API assumes the next weekday and does not model holidays. The onchain clock does.";
const SUSPECT_TIP =
  "Older Signal API builds fell back to ALLOW when the Rulebook read failed. The repo's latest build halts instead (RULEBOOK_UNREADABLE), so treat this ALLOW as unverified.";

/** Live staleness = staleness_sec + time since as_of. */
export const liveStaleness = (s: Signal, now: number) =>
  s.stalenessSec === null ? null : s.stalenessSec + (now ? Math.max(0, now - Date.parse(s.asOf)) / 1000 : 0);

function SourceBadge({ label, source }: { label: string; source: Signal["clockSource"] | undefined }) {
  if (!source) return null;
  if (source === "onchain") {
    return <span className="rounded-full border border-platen-rule px-2 py-0.5 text-platen-dim">{label}: onchain</span>;
  }
  return (
    <Tip content={FALLBACK_TIP}>
      <span className="rounded-full border border-defer-t px-2 py-0.5 text-defer-t">{label}: fallback</span>
    </Tip>
  );
}

function DecisionLine({ s, staleness, now }: { s: Signal; staleness: number | null; now: number }) {
  const param = fmtParam(s.action, s.ruleParam);
  const what = param ? `${s.action} ${param}` : s.action;
  if (s.reason === "FEED_UNAVAILABLE") {
    return (
      <>
        No price: the feed read failed
        {s.note ? (
          <>
            {" ("}
            <Tip content={s.note}>
              <span className="inline-block max-w-[24ch] truncate align-bottom">{s.note}</span>
            </Tip>
            {")"}
          </>
        ) : null}
        .
      </>
    );
  }
  if (s.reason === "RULEBOOK_UNREADABLE") return <>Rules unreadable: the API couldn&apos;t read the Rulebook, so it fails closed.</>;
  if (s.reason === "STALE_FEED") {
    return (
      <>
        OPEN, but the last print is {staleness === null ? "too" : fmtDuration(staleness)} old (the limit is 15 minutes), so HALT: stale,
        fail closed.
      </>
    );
  }
  if (s.anchorState === "CLOSED") {
    let tail: ReactNode = null;
    if (s.resumesAt) {
      const left = (Date.parse(s.resumesAt) - now) / 1000;
      tail =
        now && left <= 0 ? (
          " Past the estimated open; waiting for the onchain clock."
        ) : (
          <>
            {" "}
            Resumes in an{" "}
            <Tip content={RESUMES_TIP}>
              <span className="underline decoration-dotted underline-offset-4">estimated</span>
            </Tip>{" "}
            {now ? fmtDuration(left) : "—"}.
          </>
        );
    }
    return (
      <>
        CLOSED, so {what}.{tail}
      </>
    );
  }
  return <>OPEN and fresh, so {what}.</>;
}

function FeedColumn({ feed, s, now }: { feed: string; s: Signal | undefined; now: number }) {
  if (!s) {
    return (
      <div className="space-y-2">
        <h4 className="data font-semibold text-platen-text">{feed}</h4>
        <p className="text-[14px] text-platen-dim">The response has no {feed} signal for this chain.</p>
      </div>
    );
  }
  const staleness = liveStaleness(s, now);
  const closed = s.anchorState === "CLOSED";
  const failClosed = !closed && staleness !== null && staleness >= STALE_FEED_SEC;
  const gaugeTone = closed ? "neutral" : failClosed ? "bad" : "ok";
  const gaugeLabel = closed ? "expected while closed" : failClosed ? "stale, fail closed" : "fresh";
  const param = fmtParam(s.action, s.ruleParam);
  const suspect = s.action === "ALLOW" && s.ruleSource === "pilot-fallback";
  return (
    <div className="space-y-2.5">
      <h4 className="data flex items-center justify-between font-semibold text-platen-text">
        <span>{feed}</span>
        <span className="font-normal text-platen-dim">{s.anchorState}</span>
      </h4>
      <p className="font-mono text-[26px] font-semibold leading-none text-platen-text [font-stretch:87.5%] tnum">
        {s.lastLivePrint ? (
          <Flash value={s.lastLivePrint.price}>
            <span title={fmtPriceFull(s.lastLivePrint.price)}>{fmtPrice(s.lastLivePrint.price)}</span>
          </Flash>
        ) : (
          "—"
        )}
      </p>
      {s.lastLivePrint ? (
        <p className="data text-platen-dim">last print {fmtUtcTime(Date.parse(s.lastLivePrint.updatedAt))} UTC</p>
      ) : null}
      <div className="data">
        <div className="flex items-center gap-2">
          <span className="text-platen-dim">staleness</span>
          <span className={failClosed ? "font-semibold text-halt-t" : "text-platen-text"}>
            {staleness === null ? "—" : fmtDuration(staleness)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Gauge value={staleness} max={STALE_FEED_SEC * 2} mark={STALE_FEED_SEC} tone={gaugeTone} width={88} label="against the 900 s line" />
          <span className={failClosed ? "text-halt-t" : "text-platen-dim"}>{gaugeLabel}</span>
        </div>
      </div>
      <div className="data flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Flash value={`${s.action}/${s.reason}`}>
          <ActionChip action={s.action} surface="platen" />
        </Flash>
        {param ? <span className="text-platen-text">{param}</span> : null}
        <span className="text-platen-dim">{s.reason || "no reason"}</span>
      </div>
      <div className="data flex flex-wrap gap-1.5 text-[11.5px]">
        <SourceBadge label="clock" source={s.clockSource} />
        <SourceBadge label="rule" source={s.ruleSource} />
        {suspect ? (
          <Tip content={SUSPECT_TIP}>
            <span className="rounded-full border border-defer-t px-2 py-0.5 text-defer-t">suspect ALLOW</span>
          </Tip>
        ) : null}
      </div>
      <p className="text-[14px] leading-snug text-platen-text">
        <DecisionLine s={s} staleness={staleness} now={now} />
      </p>
    </div>
  );
}

export function PricesSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {FEEDS.map((f) => (
        <div key={f} data-skeleton="" className="space-y-2.5">
          <p className="data font-semibold text-platen-text">{f}</p>
          <Skel w="7ch" className="!h-6" />
          <Skel w="14ch" />
          <Skel w="12ch" />
          <Skel w="18ch" />
        </div>
      ))}
    </div>
  );
}

export function PricesPanel({ data, now, problems, boot }: { data: SignalState; now: number; problems: string[]; boot: boolean }) {
  const served = signalChains(data);
  const [picked, setPicked] = useState("46630");
  const chain = served.includes(picked) ? picked : (served[0] ?? "46630");
  const signals = signalsFor(data, chain);
  const legacy = data.shape === "legacy";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Chain for the price signals" className="flex flex-wrap gap-1.5">
          {CHAINS.map((c) => {
            const available = served.includes(c.id);
            const active = available && c.id === chain;
            const label = legacy && c.id === "46630" ? `${c.name} ${c.id} (single-chain API)` : c.name;
            const chip = (
              <button
                type="button"
                aria-pressed={active}
                aria-disabled={!available || undefined}
                onClick={() => available && setPicked(c.id)}
                className={`${chipBase} ${
                  active
                    ? "border-platen-text bg-platen-text text-platen"
                    : available
                      ? "border-platen-rule text-platen-text hover:border-platen-dim"
                      : "border-dashed border-platen-rule text-platen-dim"
                }`}
              >
                {label}
              </button>
            );
            if (available) return <span key={c.id}>{chip}</span>;
            return (
              <Tip key={c.id} content={legacy ? ONE_CHAIN_TIP : `The Signal API sent no signals for ${c.name}.`} focusable={false}>
                {chip}
              </Tip>
            );
          })}
        </div>
      </div>
      <p className="text-[13px] text-platen-dim">
        Prices are Chainlink prints on Robinhood Chain mainnet; the clock and rule beside them are read from the {chainName(chain)}{" "}
        testnet contracts by the Signal API.
      </p>
      <div className={`grid gap-6 sm:grid-cols-3 ${boot ? "print-row" : ""}`} style={boot ? { animationDelay: "420ms" } : undefined}>
        {FEEDS.map((f) => (
          <FeedColumn key={f} feed={f} s={signals.find((s) => s.feed === f)} now={now} />
        ))}
      </div>
      {problems.length ? (
        <details className="text-[13px] text-platen-dim">
          <summary>
            The response had {problems.length} {problems.length === 1 ? "entry" : "entries"} this page couldn&apos;t read.
          </summary>
          <ul className="data mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
