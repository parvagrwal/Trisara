"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FreshnessChip, SourceGate, isDim } from "./ErrorPanel";
import { PlainEnglish } from "./PlainEnglish";
import { PricesPanel, PricesSkeleton } from "./PricesPanel";
import { RawPanel } from "./RawPanel";
import { RegionBoundary } from "./RegionBoundary";
import { RulebookMatrix, RulebookSkeleton } from "./RulebookMatrix";
import { SessionSkeleton, SessionTable } from "./SessionTable";
import { SourceChip } from "./SourceChip";
import { ChangeLog } from "./ChangeLog";
import {
  deriveStatus,
  indexerAgeSec,
  setPaused,
  signalAgeSec,
  useIndexer,
  useNow,
  usePaused,
  useSignal,
  type SourceState,
  type Status,
} from "@/lib/live";
import { fmtDuration, fmtLatency } from "@/lib/format";
import { CLOCK_SKEW_HINT_SEC } from "@/lib/config";
import { useBootPrint, useMedia } from "@/lib/ui";

type Tab = "session" | "rulebook" | "prices";
const TABS: { id: Tab; label: string }[] = [
  { id: "session", label: "Session" },
  { id: "rulebook", label: "Rulebook" },
  { id: "prices", label: "Prices" },
];

const toggle =
  "tap inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-3 font-mono text-[12px] [font-stretch:87.5%]";

/** The real requests, printed as the commands they are. */
function CurlLine({ source, status, summary }: { source: SourceState<unknown>; status: Status; summary: string }) {
  const now = useNow();
  let result: string;
  if (status === "loading") result = "waiting for the first response";
  else if (status === "waking") {
    const s = source.firstStartedAt && now ? Math.floor((now - source.firstStartedAt) / 1000) : 0;
    result = `waiting ${s}s: the free host is waking up`;
  } else if (status === "warming") result = "503: warming up, no snapshot yet";
  else if (source.schema) result = `${source.raw?.status ?? ""}: unsupported schema`;
  else if (!source.data && source.failure) result = `failed: ${source.failure.kind === "http" ? `HTTP ${source.failure.status}` : source.failure.message}`;
  else if (source.failure) result = `latest request failed (${source.failure.message}); showing the last good response`;
  else result = `${source.raw?.status ?? 200}, ${summary}, ${fmtLatency(source.latencyMs)}`;
  return (
    <div className="data">
      <div className="break-all">
        <span className="select-none text-platen-dim">$ </span>
        <span className="text-platen-text">curl -s {source.url}</span>
      </div>
      <div className={`pl-[2ch] ${status === "error" ? "text-halt-t" : "text-platen-dim"}`}>{result}</div>
    </div>
  );
}

function Region({
  id,
  title,
  chip,
  children,
  tabbed,
  hidden,
}: {
  id: Tab;
  title: string;
  chip?: ReactNode;
  children: ReactNode;
  tabbed: boolean;
  hidden: boolean;
}) {
  return (
    <section
      id={`term-${id}`}
      aria-labelledby={tabbed ? `tab-${id}` : `term-${id}-title`}
      role={tabbed ? "tabpanel" : undefined}
      className={`${hidden ? "hidden" : ""} min-w-0 space-y-3 min-[900px]:block`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`term-${id}-title`} className={`font-mono text-[14px] font-semibold text-platen-text ${tabbed ? "sr-only" : ""}`}>
          {title}
        </h3>
        {chip}
      </div>
      {children}
    </section>
  );
}

export function Terminal() {
  const indexer = useIndexer();
  const signal = useSignal();
  const now = useNow();
  const paused = usePaused();
  const iAge = indexerAgeSec(indexer, now);
  const sAge = signalAgeSec(signal, now);
  const iStatus = deriveStatus(indexer, now, iAge);
  const sStatus = deriveStatus(signal, now, sAge);
  const iBoot = useBootPrint(indexer.firstDataAt);
  const sBoot = useBootPrint(signal.firstDataAt);
  const [raw, setRaw] = useState(false);
  const [tab, setTab] = useState<Tab>("session");
  const wide = useMedia("(min-width: 900px)", true);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ session: null, rulebook: null, prices: null });

  const chains = indexer.data ? Object.keys(indexer.data.chains).length : 0;
  const iSummary = `${chains} chains, snapshot ${iAge === null ? "—" : fmtDuration(iAge)} old`;
  const sSummary = signal.data
    ? `${signal.data.signals.length} signals, ${signal.data.shape === "legacy" ? "single-chain shape (Robinhood Chain 46630)" : "multi-chain shape"}`
    : "";
  const skew = indexer.data && now ? (Date.parse(indexer.data.ts) - now) / 1000 : 0;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const t = TABS[next]!.id;
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  const tabbed = !wide;
  return (
    <div>
      <div data-check="terminal" className="on-platen overflow-hidden rounded-[10px] bg-platen text-platen-text">
        <div className="flex flex-wrap items-center gap-2 border-b border-platen-rule px-3 py-2.5 md:px-4">
          <SourceChip source={indexer} status={iStatus} />
          <SourceChip source={signal} status={sStatus} />
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              aria-pressed={raw}
              onClick={() => setRaw((r) => !r)}
              className={`${toggle} ${raw ? "border-platen-text bg-platen-text text-platen" : "border-platen-rule text-platen-text hover:border-platen-dim"}`}
            >
              raw
            </button>
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
              className={`${toggle} ${paused ? "border-defer-t text-defer-t" : "border-platen-rule text-platen-text hover:border-platen-dim"}`}
            >
              {paused ? "paused" : "pause"}
            </button>
          </div>
        </div>

        <div className="space-y-6 p-3.5 md:p-5">
          <div className="space-y-1.5">
            <CurlLine source={indexer} status={iStatus} summary={iSummary} />
            <CurlLine source={signal} status={sStatus} summary={sSummary} />
            {skew > CLOCK_SKEW_HINT_SEC ? (
              <p className="text-[12.5px] text-defer-t">
                Your device clock looks behind the server: the snapshot is stamped {fmtDuration(skew)} in your future.
              </p>
            ) : null}
          </div>

          {raw ? (
            <RawPanel />
          ) : (
            <>
              {tabbed ? (
                <div role="tablist" aria-label="Terminal panels" className="flex gap-1 border-b border-platen-rule">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      ref={(el) => {
                        tabRefs.current[t.id] = el;
                      }}
                      id={`tab-${t.id}`}
                      role="tab"
                      type="button"
                      aria-selected={tab === t.id}
                      aria-controls={`term-${t.id}`}
                      tabIndex={tab === t.id ? 0 : -1}
                      onClick={() => setTab(t.id)}
                      onKeyDown={onTabKey}
                      className={`tap -mb-px min-h-10 border-b-2 px-3 font-mono text-[13px] [font-stretch:87.5%] ${
                        tab === t.id ? "border-platen-text text-platen-text" : "border-transparent text-platen-dim"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <Region id="session" title="Session" tabbed={tabbed} hidden={tabbed && tab !== "session"} chip={<FreshnessChip source={indexer} ageSec={iAge} surface="platen" />}>
                <RegionBoundary name="session" surface="platen">
                  <SourceGate source={indexer} status={iStatus} surface="platen" skeleton={<SessionSkeleton />}>
                    {(data) => (
                      <div className={isDim(iStatus) ? "is-dim" : ""}>
                        <SessionTable data={data} now={now} boot={iBoot} />
                      </div>
                    )}
                  </SourceGate>
                </RegionBoundary>
                <p className="text-[13px] text-platen-dim">
                  The clock column is the US equities anchor (EQUITY_US) on every chain. The settlement router uses the Fed
                  banking-day anchor, which the indexer doesn&apos;t poll.
                </p>
              </Region>

              <Region id="rulebook" title="Rulebook" tabbed={tabbed} hidden={tabbed && tab !== "rulebook"} chip={<FreshnessChip source={indexer} ageSec={iAge} surface="platen" />}>
                <RegionBoundary name="rulebook" surface="platen">
                  <SourceGate source={indexer} status={iStatus} surface="platen" skeleton={<RulebookSkeleton />}>
                    {(data) => (
                      <div className={`space-y-5 ${isDim(iStatus) ? "is-dim" : ""}`}>
                        <RulebookMatrix data={data} boot={iBoot} />
                        <p className="text-[13px] text-platen-dim">
                          The wildcard asset (bytes32 zero) rule, read by the indexer. Venues query the Rulebook; the guarded
                          routers don&apos;t read it onchain yet. HALT with NO_RULE means the venue has published nothing and
                          the contract fails closed.
                        </p>
                        <div className="border-t border-platen-rule pt-4">
                          <PlainEnglish data={data} />
                        </div>
                      </div>
                    )}
                  </SourceGate>
                </RegionBoundary>
              </Region>

              <Region id="prices" title="Prices" tabbed={tabbed} hidden={tabbed && tab !== "prices"} chip={<FreshnessChip source={signal} ageSec={sAge} surface="platen" />}>
                <RegionBoundary name="prices" surface="platen">
                  <SourceGate source={signal} status={sStatus} surface="platen" skeleton={<PricesSkeleton />}>
                    {(data) => (
                      <div className={isDim(sStatus) ? "is-dim" : ""}>
                        <PricesPanel data={data} now={now} problems={signal.problems} boot={sBoot} />
                      </div>
                    )}
                  </SourceGate>
                </RegionBoundary>
              </Region>
            </>
          )}
        </div>
      </div>
      <RegionBoundary name="change log">
        <ChangeLog />
      </RegionBoundary>
    </div>
  );
}
