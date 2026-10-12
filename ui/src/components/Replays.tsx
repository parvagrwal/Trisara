"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { withBase } from "@/lib/withBase";
import { useReducedMotion, useSeenOnce } from "@/lib/ui";
import type { ReplayBase, ReplayHims, ReplayJelly, ReplayStall, ReplayUsdc } from "@/lib/types";

const FILES = ["hims-aug29-31-2026.json", "jelly-mar2025.json", "rh-stall-sep4-2026.json", "usdc-mar2023.json"] as const;

type Load = { state: "loading" } | { state: "error"; reason: string } | { state: "ok"; data: ReplayBase };

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN);
const decimalsOf = (v: unknown) => (typeof v === "string" && v.includes(".") ? v.split(".")[1]!.length : 0);
const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** Counts from 0 to target once `active` turns true. Reduced motion: shows the target at once. */
function useCountUp(target: number, active: boolean): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active || !Number.isFinite(target)) return;
    if (reduced) {
      const id = requestAnimationFrame(() => setV(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setV(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduced]);
  return active ? v : 0;
}

function Count({ value, active, format }: { value: number; active: boolean; format: (n: number) => string }) {
  const v = useCountUp(value, active);
  return (
    <span className="tnum">
      <span aria-hidden="true">{format(v)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

interface BarRow {
  label: "unguarded" | "guarded";
  value: number;
  shown: number;
  format: (n: number) => string;
  note?: string;
}

/** A/B horizontal bars, scaled to the larger value. */
function Bars({ rows, active, unit }: { rows: BarRow[]; active: boolean; unit: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="space-y-2" role="group" aria-label={unit}>
      <p className="font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">{unit}</p>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[9ch_1fr] items-center gap-3">
          <span className="data text-ink-2">{r.label}</span>
          <div className="flex items-center gap-3">
            <div className="relative h-3.5 flex-1 bg-bar">
              <div
                className={`grow-x absolute inset-y-0 left-0 ${active ? "is-grown" : ""} ${r.label === "unguarded" ? "bg-halt" : "bg-ink"}`}
                style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%` }}
              />
              {r.value === 0 ? <div className="absolute inset-y-0 left-0 w-0.5 bg-ink" aria-hidden="true" /> : null}
            </div>
            <span className="data min-w-[11ch] text-right font-semibold">
              <Count value={r.shown} active={active} format={r.format} />
            </span>
          </div>
          {r.note ? <span className="col-start-2 text-[13px] text-ink-2">{r.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function Hims({ d, active }: { d: ReplayHims; active: boolean }) {
  const ug = num(d.unguarded?.lossUsd);
  const g = num(d.guarded?.lossUsd);
  return (
    <>
      <Bars
        unit="loss in USD"
        active={active}
        rows={[
          { label: "unguarded", value: ug, shown: ug, format: (n) => usd(n, decimalsOf(d.unguarded?.lossUsd)), note: d.unguarded?.action },
          { label: "guarded", value: g, shown: g, format: (n) => usd(n, decimalsOf(d.guarded?.lossUsd)) },
        ]}
      />
      <p className="text-[14px]">
        guarded: <span className="data">{d.guarded?.action}</span>, {d.guarded?.fillsOutsideCollar} fills outside the collar
      </p>
      {d.mondayOutage ? <p className="text-[14px] text-ink-2">Monday outage: {d.mondayOutage}</p> : null}
    </>
  );
}

function Jelly({ d, active }: { d: ReplayJelly; active: boolean }) {
  const ug = num(d.unguarded?.liquidations);
  const g = num(d.guarded?.liquidations);
  const int = (n: number) => String(Math.round(n));
  return (
    <>
      <Bars
        unit="liquidations"
        active={active}
        rows={[
          { label: "unguarded", value: ug, shown: ug, format: int },
          { label: "guarded", value: g, shown: g, format: int },
        ]}
      />
      <p className="data">
        debt after: unguarded {d.unguarded?.debtAfter}, guarded {d.guarded?.debtAfter}
      </p>
      {d.mechanism ? <p className="text-[14px] text-ink-2">{d.mechanism}</p> : null}
    </>
  );
}

function Stall({ d, active }: { d: ReplayStall; active: boolean }) {
  const gap = num(d.liveness?.gapSec);
  const maxGap = num(d.liveness?.maxGapSec);
  const scale = Math.max(gap, maxGap) * 1.1 || 1;
  return (
    <>
      <div className="space-y-2">
        <p className="font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">block-timestamp gap against the liveness limit</p>
        <div className="relative h-3.5 bg-bar" aria-hidden="true">
          <div className={`grow-x absolute inset-y-0 left-0 bg-halt ${active ? "is-grown" : ""}`} style={{ width: `${(gap / scale) * 100}%` }} />
          <div className="absolute -bottom-1.5 -top-1.5 w-0.5 bg-ink" style={{ left: `${(maxGap / scale) * 100}%` }} />
        </div>
        <p className="data flex flex-wrap justify-between gap-2">
          <span>
            gap <span className="font-semibold"><Count value={gap} active={active} format={(n) => `${Math.round(n)} s`} /></span>
            {d.liveness?.tripped ? <span className="ml-2 font-semibold text-halt">tripped</span> : null}
          </span>
          <span className="text-ink-2">limit {maxGap} s (tick)</span>
        </p>
      </div>
      <p className="text-[14px]">
        PriceIntegrity: <span className="data font-semibold">{d.priceIntegrity}</span>; liquidations during the stall:{" "}
        <span className="data font-semibold">{d.liquidationsDuringStall}</span>
      </p>
      {d.recovery ? <p className="text-[14px] text-ink-2">Recovery: {d.recovery}</p> : null}
    </>
  );
}

function Usdc({ d, active }: { d: ReplayUsdc; active: boolean }) {
  const ug = num(d.unguarded?.lossUsd);
  const received = num(d.guarded?.merchantReceivedUsd);
  return (
    <>
      <Bars
        unit="loss in USD"
        active={active}
        rows={[
          { label: "unguarded", value: ug, shown: ug, format: (n) => usd(n, decimalsOf(d.unguarded?.lossUsd)), note: `paid ${d.unguarded?.paidUsdcAtPar} USDC at par, worth ${usd(num(d.unguarded?.valueUsd))}` },
          { label: "guarded", value: 0, shown: received, format: (n) => usd(n, decimalsOf(d.guarded?.merchantReceivedUsd)), note: "no loss; the number is what the merchant received" },
        ]}
      />
      <p className="text-[14px]">
        guarded: <span className="data">{d.guarded?.usdcAtPar}</span>
      </p>
      {d.guarded?.tip403 ? (
        <p className="text-[14px] text-ink-2">
          TIP-403: payee <span className="data">{d.guarded.tip403.payee}</span>, refund {d.guarded.tip403.refund}
        </p>
      ) : null}
    </>
  );
}

function RawJson({ data }: { data: unknown }) {
  return (
    <details>
      <summary className="font-mono text-[12px] text-ink-2">raw JSON</summary>
      <pre tabIndex={0} className="data mt-1 overflow-x-auto whitespace-pre-wrap break-all bg-bar p-2">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

class FrameBoundary extends Component<{ data: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RawJson data={this.props.data} /> : this.props.children;
  }
}

function Frame({ file, load, active }: { file: string; load: Load; active: boolean }) {
  let body: ReactNode;
  let caption: ReactNode = null;
  let footer: ReactNode = null;
  let title = file.replace(/\.json$/, "");
  if (load.state === "loading") {
    body = (
      <div data-skeleton="" className="space-y-2">
        <span className="skel block w-full" />
        <span className="skel block w-2/3" />
      </div>
    );
  } else if (load.state === "error") {
    body = (
      <p className="text-[14px]">
        Couldn&apos;t load {file} ({load.reason}). Run <code className="data">forge test</code> to regenerate it, or check the
        deployment includes /replays.
      </p>
    );
  } else {
    const d = load.data;
    title = d.scenario;
    caption = d.incident ? <p className="font-sans italic text-ink">{d.incident}</p> : null;
    footer = d.generatedBy ? <p className="data border-t border-rule pt-2 text-ink-2">{d.generatedBy}</p> : null;
    let view: ReactNode;
    switch (d.scenario) {
      case "hims-weekend-spike":
        view = <Hims d={d as ReplayHims} active={active} />;
        break;
      case "jelly-squeeze":
        view = <Jelly d={d as ReplayJelly} active={active} />;
        break;
      case "sequencer-stall":
        view = <Stall d={d as ReplayStall} active={active} />;
        break;
      case "usdc-depeg-tip403":
        view = <Usdc d={d as ReplayUsdc} active={active} />;
        break;
      default:
        view = <RawJson data={d} />;
    }
    // A file whose fields don't match its scenario falls back to the raw JSON, never a crash.
    body = <FrameBoundary data={d}>{view}</FrameBoundary>;
  }
  return (
    <figure className="flex flex-col gap-3 border-t-2 border-ink pt-3">
      <p className="data font-semibold">{title}</p>
      {caption ? <figcaption>{caption}</figcaption> : null}
      <div className="space-y-3">{body}</div>
      {footer ? <div className="mt-auto">{footer}</div> : null}
    </figure>
  );
}

export function Replays() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref, 0.15);
  const [loads, setLoads] = useState<Record<string, Load>>(() => Object.fromEntries(FILES.map((f) => [f, { state: "loading" }])));

  useEffect(() => {
    let cancelled = false;
    for (const file of FILES) {
      fetch(withBase(`/replays/${file}`))
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: unknown = await res.json();
          if (typeof json !== "object" || json === null || typeof (json as ReplayBase).scenario !== "string") {
            throw new Error("no scenario key");
          }
          if (!cancelled) setLoads((l) => ({ ...l, [file]: { state: "ok", data: json as ReplayBase } }));
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoads((l) => ({ ...l, [file]: { state: "error", reason: e instanceof Error ? e.message : String(e) } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={ref} className="space-y-6">
      <h3 className="text-[22px]">Replays</h3>
      <div className="grid gap-x-10 gap-y-10 md:grid-cols-2">
        {FILES.map((f) => (
          <Frame key={f} file={f} load={loads[f]!} active={seen} />
        ))}
      </div>
      <p className="text-[14px] text-ink-2">
        Reenacted in Forge tests (<code className="data">forge test Replay…</code>) with the recorded incident parameters. No
        live funds, not mainnet transactions.
      </p>
    </div>
  );
}
