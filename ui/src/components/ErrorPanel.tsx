"use client";

import { useState, type ReactNode } from "react";
import { CommandBlock } from "./CommandBlock";
import { CopyButton } from "./CopyButton";
import { retry, useNow, usePaused, type SourceState, type Status } from "@/lib/live";
import { fmtDuration } from "@/lib/format";
import { LATE_AFTER_SEC, STALLED_AFTER_SEC } from "@/lib/config";

const SOURCE_NAME = { indexer: "indexer", signal: "Signal API" } as const;

type Surface = "paper" | "platen";
const dimText = (s: Surface) => (s === "platen" ? "text-platen-dim" : "text-ink-2");

/** first fetch pending 4 s or more */
export function WakingNote({ source, surface }: { source: SourceState<unknown>; surface: Surface }) {
  const now = useNow();
  const secs = source.firstStartedAt && now ? Math.max(0, Math.floor((now - source.firstStartedAt) / 1000)) : 0;
  return (
    <p className={`text-[14px] ${dimText(surface)}`}>
      Waking the {SOURCE_NAME[source.id]}. The free host sleeps when idle, so the first response can take up to a minute.{" "}
      <span className="data whitespace-nowrap">{secs}s</span>
    </p>
  );
}

/** indexer HTTP 503 with the warm-up body: not an error */
export function WarmingNote({ surface }: { surface: Surface }) {
  return (
    <p className={`text-[14px] ${dimText(surface)}`}>
      The indexer is warming up and has no snapshot yet. Retrying every 5 seconds.
    </p>
  );
}

function reasonText(source: SourceState<unknown>): string {
  const f = source.failure;
  if (!f) return "";
  if (f.kind === "timeout") return `timed out (${f.message})`;
  if (f.kind === "http") return `HTTP ${f.status}`;
  return f.message;
}

/** request failed and there is no data */
export function ErrorPanel({ source, surface }: { source: SourceState<unknown>; surface: Surface }) {
  const now = useNow();
  const paused = usePaused();
  const retrying = source.inFlightSince !== null;
  const next = source.nextAttemptAt && now ? Math.max(0, Math.ceil((source.nextAttemptAt - now) / 1000)) : null;
  const platen = surface === "platen";
  return (
    <div className={`space-y-3 border-l-2 py-1 pl-4 ${platen ? "border-halt-t" : "border-halt"}`}>
      <p className={`text-[14px] ${platen ? "text-platen-text" : "text-ink"}`}>
        <span className="data">GET {source.url}</span> failed: {reasonText(source)}.{" "}
        <span className={dimText(surface)}>
          {retrying
            ? "Retrying now."
            : paused
              ? "Polling is paused."
              : next !== null
                ? `Retrying automatically in ${next}s.`
                : ""}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry(source.id)}
          disabled={retrying}
          className={`tap rounded-[6px] border px-3 py-1.5 font-mono text-[12px] [font-stretch:87.5%] ${
            platen ? "border-platen-dim text-platen-text" : "border-ink bg-ink text-fanfold"
          } disabled:opacity-100`}
        >
          {retrying ? "Retrying" : "Retry"}
        </button>
        <span className={`text-[13px] ${dimText(surface)}`}>Or try it from a terminal:</span>
      </div>
      <CommandBlock code={`curl -s ${source.url}`} label={`the curl command for the ${SOURCE_NAME[source.id]}`} surface={surface} />
    </div>
  );
}

/** schemaVersion is not 2: no partial rendering, raw JSON available */
export function SchemaNote({ source, surface }: { source: SourceState<unknown>; surface: Surface }) {
  const [open, setOpen] = useState(false);
  const v = source.schema?.version;
  const shown = v === undefined ? "no schemaVersion" : `schema ${JSON.stringify(v)}`;
  const platen = surface === "platen";
  return (
    <div className="space-y-2">
      <p className={`text-[14px] ${platen ? "text-platen-text" : "text-ink"}`}>
        The indexer is serving {shown}; this page understands schema 2.
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`tap rounded-[6px] border px-3 py-1 font-mono text-[12px] ${platen ? "border-platen-dim text-platen-text" : "border-ink-3 text-ink"}`}
      >
        {open ? "Hide raw JSON" : "Show raw JSON"}
      </button>
      {open && source.raw ? (
        <div className="flex items-start gap-2">
          <pre tabIndex={0} className={`data max-h-64 flex-1 overflow-auto whitespace-pre p-2 ${platen ? "bg-platen-band" : "bg-bar"}`}>
            {source.raw.body}
          </pre>
          <CopyButton text={source.raw.body} surface={surface} describe="the raw response" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders children(data) when data exists; otherwise the loading skeleton,
 * the waking note, the warming note, the schema note or the error panel.
 */
export function SourceGate<T>({
  source,
  status,
  surface,
  skeleton,
  children,
}: {
  source: SourceState<T>;
  status: Status;
  surface: Surface;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (source.schema) return <SchemaNote source={source} surface={surface} />;
  if (source.data !== null) return <>{children(source.data)}</>;
  if (status === "error") return <ErrorPanel source={source} surface={surface} />;
  return (
    <div className="space-y-3">
      {status === "waking" ? <WakingNote source={source} surface={surface} /> : null}
      {status === "warming" ? <WarmingNote surface={surface} /> : null}
      {skeleton}
    </div>
  );
}

/** Amber/red snapshot-age chip ("late" over 150 s, "stalled" over 600 s), or the "stale" chip after a failed refetch. */
export function FreshnessChip({
  source,
  ageSec,
  surface,
}: {
  source: SourceState<unknown>;
  ageSec: number | null;
  surface: Surface;
}) {
  const platen = surface === "platen";
  const amber = platen ? "border-defer-t text-defer-t" : "border-defer text-defer";
  const red = platen ? "border-halt-t text-halt-t" : "border-halt text-halt";
  const now = useNow();
  if (!source.data) return null;
  const chip = "inline-flex items-center rounded-full border px-2 py-0.5 data whitespace-nowrap";
  if (ageSec !== null && ageSec > STALLED_AFTER_SEC) {
    return <span className={`${chip} ${red} whitespace-normal`}>stalled: snapshot {fmtDuration(ageSec)} old. The poller may be down.</span>;
  }
  if (ageSec !== null && ageSec > LATE_AFTER_SEC) {
    return <span className={`${chip} ${amber}`}>late: snapshot {fmtDuration(ageSec)} old</span>;
  }
  if (source.failure || source.warming) {
    const since = source.dataAt && now ? (now - source.dataAt) / 1000 : null;
    return <span className={`${chip} ${amber}`}>stale, last updated {since === null ? "—" : fmtDuration(since)} ago</span>;
  }
  return null;
}

/** True when a region's data should be dimmed (stale, late or stalled). */
export const isDim = (status: Status) => status === "stale";
