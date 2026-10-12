"use client";

import { StatusDot, type DotTone } from "./StatusDot";
import { usePaused, useNow, type SourceState, type Status } from "@/lib/live";
import { fmtDuration, fmtLatency } from "@/lib/format";

const NAME = { indexer: "indexer", signal: "Signal API" } as const;

export const toneFor = (status: Status): DotTone =>
  status === "ok" ? "ok" : status === "stale" ? "late" : status === "error" ? "down" : "none";

/** Terminal title-bar chip: dot, name, "polled {age} ago", latency of the last request. */
export function SourceChip({ source, status }: { source: SourceState<unknown>; status: Status }) {
  const now = useNow();
  const paused = usePaused();
  const lastAt = Math.max(source.raw?.at ?? 0, source.failure?.at ?? 0) || null;
  const age = lastAt && now ? (now - lastAt) / 1000 : null;
  let line: string;
  if (status === "loading" || status === "waking") line = "first request pending";
  else if (status === "warming") line = "warming up";
  else line = age === null ? "—" : `polled ${fmtDuration(age)} ago`;
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-platen-rule px-3 py-1 font-mono text-[12px] text-platen-text [font-stretch:87.5%]">
      <StatusDot tone={toneFor(status)} surface="platen" pulse={status === "ok" && !paused} />
      <span className="font-semibold">{NAME[source.id]}</span>
      <span className="text-platen-dim">{paused ? "paused" : line}</span>
      <span className="text-platen-dim tnum">{fmtLatency(source.latencyMs)}</span>
      <span className="sr-only">, status {status}</span>
    </span>
  );
}
