"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ActionChip } from "./ActionChip";
import { LockGlyph, OpenGlyph } from "./Glyphs";
import { StateExplorer } from "./StateExplorer";
import { CHAINS, chainName, consumerAddress, coreAddress, type CoreContract } from "@/data/chains";
import { indexerAgeSec, useIndexer, useNow, useSignal } from "@/lib/live";
import { fmtBlock, fmtDuration, fmtParamShort, fmtPrice } from "@/lib/format";
import { repoFile } from "@/lib/config";
import { useMedia, useReducedMotion, useSeenOnce } from "@/lib/ui";
import { CLASSES, FEEDS, isRuleOk, type ChainState, type FeedSymbol, type Signal } from "@/lib/types";
import { chipBase } from "@/lib/styles";
import { liveStaleness } from "./PricesPanel";

// ---------------------------------------------------------------- topology

type NodeId = "calendar" | "oracle" | "clock" | "integrity" | "feed" | "rulebook" | "routers";
type Rect = { x: number; y: number; w: number; h: number };
type EdgeKind = "static" | "solid" | "thin" | "policy";
interface Edge {
  id: string;
  from: NodeId;
  to: NodeId | "venue" | "signalapi";
  kind: EdgeKind;
  label: string;
  d: string;
  /** Label position and anchor; omitted when the layout states it elsewhere. */
  at?: { x: number; y: number; anchor: "start" | "middle" | "end"; lines?: string[]; rotate?: number };
}
interface Layout {
  w: number;
  h: number;
  nodes: Record<NodeId, Rect>;
  sub: Record<"swap" | "lender" | "settlement", Rect>;
  termini: Record<"venue" | "signalapi", Rect>;
  lane: Rect;
  laneLabel: { x: number; y: number };
  edges: Edge[];
  packetsOpen: string[];
  packetsClosed: string[];
  noSignalAt: { x: number; y: number };
}

const EDGE_LABELS = {
  e1: "compiled in as bitmaps",
  e2: "isOpen(anchor, now)",
  e3: "reference price, feed price, flags",
  e4: "underlying.latestRoundData()",
  e5: "state and reason",
  e6: "guarded price",
  e7: "reads the clock directly: equity anchor",
  e8: "reads the clock directly: Fed anchor",
  e9: "venues query decision()",
  e10: "Signal API reads it",
};

const WIDE: Layout = {
  w: 1120,
  h: 566,
  nodes: {
    calendar: { x: 16, y: 180, w: 150, h: 96 },
    clock: { x: 240, y: 180, w: 150, h: 96 },
    integrity: { x: 468, y: 180, w: 150, h: 96 },
    feed: { x: 694, y: 180, w: 146, h: 96 },
    oracle: { x: 520, y: 20, w: 270, h: 96 },
    routers: { x: 896, y: 150, w: 208, h: 266 },
    rulebook: { x: 468, y: 446, w: 230, h: 96 },
  },
  sub: {
    swap: { x: 906, y: 190, w: 188, h: 60 },
    lender: { x: 906, y: 256, w: 188, h: 80 },
    settlement: { x: 906, y: 342, w: 188, h: 68 },
  },
  termini: {
    venue: { x: 880, y: 456, w: 200, h: 34 },
    signalapi: { x: 880, y: 500, w: 200, h: 34 },
  },
  lane: { x: 16, y: 430, w: 1088, h: 124 },
  laneLabel: { x: 30, y: 454 },
  edges: [
    { id: "e1", from: "calendar", to: "clock", kind: "static", label: EDGE_LABELS.e1, d: "M166,228 H240", at: { x: 203, y: 166, anchor: "middle" } },
    { id: "e2", from: "clock", to: "integrity", kind: "solid", label: EDGE_LABELS.e2, d: "M390,228 H468", at: { x: 429, y: 166, anchor: "middle" } },
    { id: "e3", from: "oracle", to: "integrity", kind: "solid", label: EDGE_LABELS.e3, d: "M580,116 V148 H543 V180", at: { x: 572, y: 140, anchor: "end" } },
    { id: "e4", from: "oracle", to: "feed", kind: "solid", label: EDGE_LABELS.e4, d: "M730,116 V148 H767 V180", at: { x: 738, y: 140, anchor: "start" } },
    { id: "e5", from: "integrity", to: "feed", kind: "solid", label: EDGE_LABELS.e5, d: "M618,228 H694", at: { x: 656, y: 166, anchor: "middle" } },
    { id: "e6", from: "feed", to: "routers", kind: "solid", label: EDGE_LABELS.e6, d: "M840,228 H906", at: { x: 870, y: 202, anchor: "middle", lines: ["guarded", "price"] } },
    { id: "e7", from: "clock", to: "routers", kind: "thin", label: EDGE_LABELS.e7, d: "M315,276 V305 H906", at: { x: 330, y: 299, anchor: "start" } },
    { id: "e8", from: "clock", to: "routers", kind: "thin", label: EDGE_LABELS.e8, d: "M315,276 V376 H906", at: { x: 330, y: 370, anchor: "start" } },
    { id: "e9", from: "rulebook", to: "venue", kind: "policy", label: EDGE_LABELS.e9, d: "M698,473 H880", at: { x: 789, y: 466, anchor: "middle" } },
    { id: "e10", from: "rulebook", to: "signalapi", kind: "policy", label: EDGE_LABELS.e10, d: "M698,517 H880", at: { x: 789, y: 510, anchor: "middle" } },
  ],
  packetsOpen: ["M390,228 H906", "M315,276 V305 H906", "M315,276 V376 H906"],
  packetsClosed: ["M468,228 H390", "M906,305 H315 V276", "M906,376 H315 V276"],
  noSignalAt: { x: 429, y: 250 },
};

const NARROW: Layout = {
  w: 360,
  h: 1046,
  nodes: {
    calendar: { x: 28, y: 12, w: 180, h: 58 },
    clock: { x: 28, y: 120, w: 180, h: 80 },
    integrity: { x: 28, y: 296, w: 180, h: 66 },
    oracle: { x: 220, y: 232, w: 134, h: 118 },
    feed: { x: 28, y: 440, w: 180, h: 62 },
    routers: { x: 8, y: 580, w: 346, h: 250 },
    rulebook: { x: 28, y: 892, w: 180, h: 128 },
  },
  sub: {
    swap: { x: 26, y: 612, w: 318, h: 62 },
    lender: { x: 26, y: 682, w: 318, h: 66 },
    settlement: { x: 26, y: 756, w: 318, h: 66 },
  },
  termini: {
    venue: { x: 222, y: 900, w: 128, h: 50 },
    signalapi: { x: 222, y: 962, w: 128, h: 50 },
  },
  lane: { x: 6, y: 856, w: 348, h: 180 },
  laneLabel: { x: 16, y: 878 },
  edges: [
    { id: "e1", from: "calendar", to: "clock", kind: "static", label: EDGE_LABELS.e1, d: "M118,70 V120", at: { x: 126, y: 99, anchor: "start" } },
    { id: "e2", from: "clock", to: "integrity", kind: "solid", label: EDGE_LABELS.e2, d: "M118,200 V296", at: { x: 126, y: 224, anchor: "start" } },
    { id: "e3", from: "oracle", to: "integrity", kind: "solid", label: EDGE_LABELS.e3, d: "M220,322 H208", at: { x: 287, y: 368, anchor: "middle", lines: ["reference price,", "feed price, flags"] } },
    { id: "e4", from: "oracle", to: "feed", kind: "solid", label: EDGE_LABELS.e4, d: "M344,350 V471 H208", at: { x: 336, y: 414, anchor: "end", lines: ["underlying.", "latestRoundData()"] } },
    { id: "e5", from: "integrity", to: "feed", kind: "solid", label: EDGE_LABELS.e5, d: "M118,362 V440", at: { x: 126, y: 392, anchor: "start" } },
    { id: "e6", from: "feed", to: "routers", kind: "solid", label: EDGE_LABELS.e6, d: "M118,502 V612", at: { x: 126, y: 550, anchor: "start" } },
    { id: "e7", from: "clock", to: "routers", kind: "thin", label: EDGE_LABELS.e7, d: "M28,160 H16 V715 H26", at: { x: 11, y: 440, anchor: "middle", rotate: -90, lines: ["reads the clock directly"] } },
    { id: "e8", from: "clock", to: "routers", kind: "thin", label: EDGE_LABELS.e8, d: "M16,715 V789 H26" },
    { id: "e9", from: "rulebook", to: "venue", kind: "policy", label: EDGE_LABELS.e9, d: "M208,925 H222" },
    { id: "e10", from: "rulebook", to: "signalapi", kind: "policy", label: EDGE_LABELS.e10, d: "M208,987 H222" },
  ],
  packetsOpen: ["M118,200 V612", "M28,160 H16 V715 H26", "M28,160 H16 V789 H26"],
  packetsClosed: ["M118,296 V200", "M26,715 H16 V160 H28", "M26,789 H16 V160 H28"],
  noSignalAt: { x: 126, y: 252 },
};

// ---------------------------------------------------------------- details text

interface Detail {
  title: string;
  live: boolean;
  what: string;
  signature: string;
  source: string;
  sourceLabel: string;
  addresses?: CoreContract | "GuardedFeed" | "routers";
}

const DETAILS: Record<NodeId, Detail> = {
  calendar: {
    title: "NYSE and Fed calendar, 2026 to 2027",
    live: false,
    what: "AnchorClock carries the NYSE and Federal Reserve calendars for 2026-01-01 to 2027-12-31 as bitmaps: holidays, early closes (13:00 ET on 2026-11-27, 2026-12-24 and 2027-11-26) and US daylight saving. They are compiled into the contract, so a session change needs no keeper transaction, and a timestamp outside the calendar is never open.",
    signature: "NYSE_HOL_0..2, NYSE_EARLY_0..2, FED_HOL_0..2 (uint256 constants)",
    source: "src/AnchorClock.sol",
    sourceLabel: "AnchorClock.sol",
  },
  oracle: {
    title: "Oracle: Chainlink equity feed and keeper reference",
    live: true,
    what: "GuardedFeed wraps an underlying Chainlink AggregatorV3 feed, and a keeper calls poke() with a reference observation. The contract re-derives the state itself and records an open print only when the state is OPEN: the keeper is trusted for observation, never for judgment.",
    signature: "underlying.latestRoundData()  poke(Observation o)",
    source: "src/GuardedFeed.sol",
    sourceLabel: "GuardedFeed.sol",
  },
  clock: {
    title: "AnchorClock",
    live: true,
    what: "isOpen is a pure function of the timestamp: EQUITY_US (0) is open on non-holiday weekdays from 09:30 to 16:00 ET, BANK_US (1) on Fed banking days. An overload takes Chainlink's marketStatusOpen flag and can only tighten.",
    signature: "function isOpen(uint8 anchor, uint256 timestamp) public pure returns (bool)",
    source: "src/AnchorClock.sol",
    sourceLabel: "AnchorClock.sol",
    addresses: "AnchorClock",
  },
  integrity: {
    title: "PriceIntegrity",
    live: false,
    what: "PriceIntegrity turns the clock, a reference price, the feed price and flags into one of seven states. The order is fail-closed: halt flag, chain degraded, zero price, then the clock regime, then freshness, velocity and deviation, and only then OPEN.",
    signature: "function evaluate(EvalInputs x) public view returns (State state, bytes32 reason)",
    source: "src/PriceIntegrity.sol",
    sourceLabel: "PriceIntegrity.sol",
    addresses: "PriceIntegrity",
  },
  feed: {
    title: "GuardedFeed",
    live: false,
    what: "A one-address Chainlink AggregatorV3 drop-in: OPEN passes the underlying print through, DISLOCATED clamps it to the last open price ± collarBps, and CLOSED or REOPENING return the last open print. STALE, HALTED and CHAIN_DEGRADED revert.",
    signature: "function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)",
    source: "src/GuardedFeed.sol",
    sourceLabel: "GuardedFeed.sol",
    addresses: "GuardedFeed",
  },
  rulebook: {
    title: "Rulebook",
    live: true,
    what: "A standalone, per-venue table with one pre-committed rule per action class: tightening applies instantly and loosening waits out a timelock. Halts and emergency flags expire within 6 hours, EXIT is always ALLOW, and with no rule published decision() fails closed to HALT / NO_RULE.",
    signature: "function decision(bytes32 asset, ActionClass cls) external view returns (Action action, uint256 param, bytes32 reason)",
    source: "src/Rulebook.sol",
    sourceLabel: "Rulebook.sol",
    addresses: "Rulebook",
  },
  routers: {
    title: "Guarded routers: Swap, Lender, Settlement",
    live: false,
    what: "The swap router fills at the guarded feed price inside ±collarBps of a keeper-set reference, refunds instantly when the feed is halted and escrows the input when the price sits outside the collar. The lender reads the clock directly for its 50% / 35% LTV and liquidates only on the reference-feed adapter, and the settlement router holds payments on a peg break while the Fed is closed or when TIP-403 blocks the payee.",
    signature: "swap(uint256)  claimRefund(uint256)  liquidate(address)  settle(address,address,uint256,bytes32)",
    source: "src/consumers",
    sourceLabel: "src/consumers/",
    addresses: "routers",
  },
};

const INCIDENT: Record<NodeId, string[]> = {
  calendar: ["e1"],
  oracle: ["e3", "e4"],
  clock: ["e1", "e2", "e7", "e8"],
  integrity: ["e2", "e3", "e5"],
  feed: ["e4", "e5", "e6"],
  rulebook: ["e9", "e10"],
  routers: ["e6", "e7", "e8"],
};

// ---------------------------------------------------------------- pieces

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const box = (r: Rect, L: Layout): CSSProperties => ({
  left: pct(r.x, L.w),
  top: pct(r.y, L.h),
  width: pct(r.w, L.w),
  height: pct(r.h, L.h),
});

function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full border border-ink ${live ? "bg-ink" : "bg-fanfold"}`}
    />
  );
}

function rulesLine(chain: ChainState | undefined) {
  if (!chain?.rules) return null;
  return CLASSES.map((cls) => {
    const r = chain.rules?.[cls];
    if (!isRuleOk(r)) return { cls, text: r ? "read error" : "—", action: null };
    return { cls, text: fmtParamShort(r.action, r.param), action: r.action };
  });
}

function priceFor(signals: Signal[], feed: FeedSymbol) {
  return signals.find((s) => s.feed === feed);
}

// ---------------------------------------------------------------- component

export function Pipeline() {
  const indexer = useIndexer();
  const signal = useSignal();
  const now = useNow();
  const reduced = useReducedMotion();
  const wide = useMedia("(min-width: 900px)", true);
  const L = wide ? WIDE : NARROW;
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref, 0.2);
  const [chainId, setChainId] = useState("46630");
  const [feed, setFeed] = useState<FeedSymbol>("AAPL");
  const [selected, setSelected] = useState<NodeId>("clock");
  const [hover, setHover] = useState<NodeId | null>(null);

  const age = indexerAgeSec(indexer, now);
  const chain = indexer.data?.chains[chainId];
  const clockOpen = chain?.healthy ? chain.clock?.open : undefined;
  const live = clockOpen !== undefined;
  // Prices are mainnet prints and identical for every chain; prefer the selected chain's entry.
  const sigs = signal.data?.signals ?? [];
  const sig = sigs.find((s) => s.feed === feed && (s.chainId ?? "46630") === chainId) ?? priceFor(sigs, feed);
  const staleness = sig ? liveStaleness(sig, now) : null;
  const rules = rulesLine(chain);
  const focus = hover ?? null;
  const lit = focus ? new Set(INCIDENT[focus]) : null;

  const nodeButton = (id: NodeId, content: ReactNode, extra = "") => (
    <button
      key={id}
      type="button"
      aria-pressed={selected === id}
      aria-label={undefined}
      onClick={() => setSelected(id)}
      onMouseEnter={() => setHover(id)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(id)}
      onBlur={() => setHover(null)}
      style={box(L.nodes[id], L)}
      className={`absolute flex flex-col items-start justify-center gap-0.5 overflow-hidden border bg-fanfold px-2.5 py-1.5 text-left font-mono leading-tight [font-stretch:87.5%] ${
        selected === id ? "border-2 border-ink shadow-[3px_3px_0_var(--color-rule)]" : "border-ink-3 hover:border-ink"
      } ${extra}`}
    >
      {content}
    </button>
  );

  const edgeStroke = (e: Edge) => {
    if (e.kind === "policy") return "var(--color-ink-2)";
    if (!live && e.kind !== "static") return "var(--color-ink-3)";
    return "var(--color-ink)";
  };

  return (
    <div ref={ref} className="space-y-5">
      <div>
        <h3 className="text-[22px]">The pipeline.</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <LiveDot live /> live data from the indexer or Signal API
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LiveDot live={false} /> reference description of the contract, not live state
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div role="group" aria-label="Chain for the pipeline" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">chain</span>
          {CHAINS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chainId === c.id}
              onClick={() => setChainId(c.id)}
              className={`${chipBase} ${chainId === c.id ? "border-ink bg-ink text-fanfold" : "border-ink-3 text-ink hover:bg-bar"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Symbol for the oracle node" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">oracle</span>
          {FEEDS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={feed === f}
              onClick={() => setFeed(f)}
              className={`${chipBase} ${feed === f ? "border-ink bg-ink text-fanfold" : "border-ink-3 text-ink hover:bg-bar"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative w-full"
        style={{ aspectRatio: `${L.w} / ${L.h}`, containerType: "inline-size", maxWidth: wide ? undefined : 440 }}
      >
        <svg
          viewBox={`0 0 ${L.w} ${L.h}`}
          className="absolute inset-0 h-full w-full font-mono [font-stretch:87.5%]"
          role="img"
          aria-labelledby="pipe-title pipe-desc"
        >
          <title id="pipe-title">Trisara call paths</title>
          <desc id="pipe-desc">
            The calendar is compiled into AnchorClock. PriceIntegrity calls AnchorClock.isOpen and takes the reference price,
            feed price and flags from the oracle; GuardedFeed reads the underlying feed and PriceIntegrity&apos;s state and
            serves the guarded price to the swap router. The lender and the settlement router read AnchorClock directly. The
            Rulebook sits on a separate policy lane: venues query decision() and the Signal API reads it; the routers
            don&apos;t call it onchain.{" "}
            {live ? `${chainName(chainId)} clock reads ${clockOpen ? "open" : "closed"}.` : "No live clock reading."}
          </desc>
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-ink-2)" />
            </marker>
          </defs>

          {/* policy lane */}
          <rect
            x={L.lane.x}
            y={L.lane.y}
            width={L.lane.w}
            height={L.lane.h}
            fill="var(--color-bar)"
            fillOpacity="0.6"
            stroke="var(--color-ink-3)"
            strokeDasharray="5 4"
          />
          <text x={L.laneLabel.x} y={L.laneLabel.y} fontSize={wide ? 12 : 11} fill="var(--color-ink)" fontWeight="600">
            Venue policy: the routers don&apos;t call it onchain.
          </text>

          {/* routers group frame */}
          <rect
            x={L.nodes.routers.x}
            y={L.nodes.routers.y}
            width={L.nodes.routers.w}
            height={L.nodes.routers.h}
            fill="none"
            stroke="var(--color-ink-3)"
          />

          {L.edges.map((e, i) => {
            const dim = lit && !lit.has(e.id) ? 0.25 : 1;
            const strong = lit?.has(e.id);
            const dashed = e.kind === "policy" || (!live && e.kind !== "static");
            const width = e.kind === "thin" ? 1 : strong ? 2.5 : 1.6;
            return (
              <g key={e.id} style={{ opacity: dim, transition: "opacity 160ms" }}>
                <path
                  d={e.d}
                  fill="none"
                  stroke={edgeStroke(e)}
                  strokeWidth={width}
                  pathLength={dashed ? undefined : 1}
                  strokeDasharray={dashed ? "5 4" : undefined}
                  markerEnd="url(#arrow)"
                  className={`${dashed ? "edge-fade" : "edge-draw"} ${seen ? "is-drawn" : ""}`}
                  style={{ "--delay": `${i * 70}ms` } as CSSProperties}
                />
                {e.at ? (
                  <text
                    x={e.at.x}
                    y={e.at.y}
                    textAnchor={e.at.anchor}
                    fontSize={wide ? 11.5 : 10.5}
                    fill="var(--color-ink-2)"
                    transform={e.at.rotate ? `rotate(${e.at.rotate} ${e.at.x} ${e.at.y})` : undefined}
                  >
                    {(e.at.lines ?? [e.label]).map((line, j) => (
                      <tspan key={j} x={e.at!.x} dy={j === 0 ? 0 : 13}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                ) : null}
              </g>
            );
          })}

          {!live ? (
            <text x={L.noSignalAt.x} y={L.noSignalAt.y} textAnchor={wide ? "middle" : "start"} fontSize={wide ? 11.5 : 10.5} fill="var(--color-ink-2)">
              no signal
            </text>
          ) : null}

          {/* packets, driven by the selected chain's live clock */}
          {live && seen && !reduced
            ? (clockOpen ? L.packetsOpen : L.packetsClosed).map((d, i) =>
                [0, 1.2].map((offset) => (
                  <circle key={`${i}-${offset}-${clockOpen}`} r={i === 0 ? 4 : 3} fill="var(--color-ink)" opacity="0">
                    <animateMotion
                      dur="2.4s"
                      begin={`${offset + 1}s`}
                      repeatCount="indefinite"
                      path={d}
                      keyPoints={clockOpen ? "0;1" : "0;1;1"}
                      keyTimes={clockOpen ? "0;1" : "0;0.6;1"}
                      calcMode="linear"
                    />
                    <animate
                      attributeName="opacity"
                      dur="2.4s"
                      begin={`${offset + 1}s`}
                      repeatCount="indefinite"
                      values={clockOpen ? "0;1;1;0" : "0;1;1;0;0"}
                      keyTimes={clockOpen ? "0;0.08;0.9;1" : "0;0.08;0.55;0.62;1"}
                    />
                  </circle>
                )),
              )
            : null}
        </svg>

        {/* HTML node layer: text scales with the diagram (container query units) */}
        <div className="absolute inset-0" style={{ fontSize: `calc(100cqw / ${L.w} * ${wide ? 12 : 12.5})` }}>
        {nodeButton(
          "calendar",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live={false} /> {wide ? "NYSE and Fed calendar" : "NYSE and Fed calendar"}
            </span>
            <span className="text-[0.92em] text-ink-2">2026 to 2027, as bitmaps</span>
          </>,
        )}
        {nodeButton(
          "oracle",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live /> Oracle
            </span>
            <span className="text-[0.88em] text-ink-2">Chainlink equity feed and keeper reference</span>
            <span className="font-mono tnum text-[1em] text-ink">
              {sig?.lastLivePrint ? (
                <>
                  {feed} {fmtPrice(sig.lastLivePrint.price)}
                  {staleness !== null ? <span className="text-ink-2">, {fmtDuration(staleness)} old</span> : null}
                </>
              ) : (
                <span className="text-ink-2">{feed} —</span>
              )}
            </span>
          </>,
        )}
        {nodeButton(
          "clock",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live /> AnchorClock
            </span>
            {live ? (
              <span className={`inline-flex items-center gap-1.5 text-[1.04em] font-semibold ${clockOpen ? "text-allow" : "text-ink"}`}>
                {clockOpen ? <OpenGlyph size={10} /> : <LockGlyph size={11} />}
                {clockOpen ? "OPEN" : "CLOSED"}
              </span>
            ) : (
              <span className="text-[0.92em] text-ink-2">{chain && !chain.healthy ? "chain down" : "no reading"}</span>
            )}
            <span className="font-mono tnum text-[0.92em] text-ink-2">{chain?.block ? `block ${fmtBlock(chain.block)}` : " "}</span>
          </>,
        )}
        {nodeButton(
          "integrity",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live={false} /> PriceIntegrity
            </span>
            <span className="text-[0.92em] text-ink-2">evaluate(): 7 states</span>
          </>,
        )}
        {nodeButton(
          "feed",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live={false} /> GuardedFeed
            </span>
            <span className="text-[0.92em] text-ink-2">latestRoundData()</span>
          </>,
        )}
        {nodeButton(
          "rulebook",
          <>
            <span className="flex items-center gap-1.5 text-[1em] font-semibold text-ink">
              <LiveDot live /> Rulebook
            </span>
            {rules ? (
              <span className="grid w-full grid-cols-[auto_1fr] gap-x-2 font-mono tnum text-[0.88em] leading-[1.35]">
                {rules.map((r) => (
                  <span key={r.cls} className="contents">
                    <span className="text-ink-2">{r.cls}</span>
                    <span className="truncate">
                      {r.action ? <ActionChip action={r.action} surface="paper" /> : null}{" "}
                      <span className="text-ink-2">{r.text}</span>
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[0.92em] text-ink-2">{chain && !chain.healthy ? "chain down" : "no reading"}</span>
            )}
          </>,
        )}
        {nodeButton(
          "routers",
          <span className="flex h-full w-full flex-col">
            <span className="flex items-center gap-1.5 pt-0.5 text-[1em] font-semibold text-ink">
              <LiveDot live={false} /> Guarded routers
            </span>
          </span>,
          "!items-stretch !justify-start !border-0 !bg-transparent !shadow-none !p-0 !px-3 !pt-2",
        )}
        {(["swap", "lender", "settlement"] as const).map((k) => {
          const text = {
            swap: ["Swap", "collar vs reference price; escrow or refund", null],
            lender: ["Lender", "LTV 50% open, 35% closed; liquidate on reference feed only", "reference-feed adapter"],
            settlement: ["Settlement", "peg break while Fed is closed → hold; blocked payee → hold", "peg adapter and TIP-403"],
          }[k];
          return (
            <div
              key={k}
              aria-hidden="true"
              style={box(L.sub[k], L)}
              className={`pointer-events-none absolute overflow-hidden border bg-fanfold px-2 py-1 font-mono leading-tight [font-stretch:87.5%] ${
                selected === "routers" ? "border-ink" : "border-ink-3"
              }`}
            >
              <span className="block text-[0.92em] font-semibold">{text[0]}</span>
              <span className="block text-[0.85em] text-ink-2">{text[1]}</span>
              {text[2] ? <span className="mt-0.5 inline-block rounded-full border border-rule px-1.5 text-[0.8em] text-ink-2">{text[2]}</span> : null}
            </div>
          );
        })}
        {(["venue", "signalapi"] as const).map((k) => (
          <div
            key={k}
            aria-hidden="true"
            style={box(L.termini[k], L)}
            className="absolute flex flex-col justify-center border border-dashed border-ink-3 bg-fanfold px-2 font-mono text-[0.92em] leading-tight [font-stretch:87.5%]"
          >
            <span className="font-semibold">{k === "venue" ? "venue contracts" : "Signal API"}</span>
            {!wide ? <span className="text-[0.85em] text-ink-2">{k === "venue" ? "query decision()" : "reads it"}</span> : null}
          </div>
        ))}
        </div>
      </div>

      <Details
        id={selected}
        chainId={chainId}
        chain={chain}
        sig={sig}
        staleness={staleness}
        ageSec={age}
      />

      <StateExplorer liveState={live ? (clockOpen ? "OPEN" : "CLOSED") : null} chainLabel={chainName(chainId)} />
    </div>
  );
}

// ---------------------------------------------------------------- details panel

function AddressRows({ kind }: { kind: NonNullable<Detail["addresses"]> }) {
  if (kind === "GuardedFeed" || kind === "routers") {
    const names = kind === "GuardedFeed" ? ["GuardedFeed"] : ["GuardedSwapRouter", "GuardedLender", "GuardedSettlementRouter"];
    return (
      <table className="data w-full">
        <caption className="mb-1 text-left text-[12px] text-ink-2">Deployed on Robinhood Chain testnet only (46630-full.json)</caption>
        <tbody>
          {names.map((n) => (
            <tr key={n} className="border-t border-rule">
              <td className="py-1 pr-3 text-ink-2">46630</td>
              <td className="py-1 pr-3">{n}</td>
              <td className="break-all py-1">{consumerAddress(n) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="data w-full">
      <caption className="mb-1 text-left text-[12px] text-ink-2">{kind} per chain (deployments/*.json)</caption>
      <tbody>
        {CHAINS.map((c) => (
          <tr key={c.id} className="border-t border-rule">
            <td className="py-1 pr-3 text-ink-2">{c.id}</td>
            <td className="py-1 pr-3">{c.name}</td>
            <td className="break-all py-1">{coreAddress(c.id, kind) ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Details({
  id,
  chainId,
  chain,
  sig,
  staleness,
  ageSec,
}: {
  id: NodeId;
  chainId: string;
  chain: ChainState | undefined;
  sig: Signal | undefined;
  staleness: number | null;
  ageSec: number | null;
}) {
  const d = DETAILS[id];
  let liveLine: ReactNode = null;
  if (id === "clock") {
    liveLine = chain?.healthy && chain.clock
      ? `${chainName(chainId)}: EQUITY_US reads ${chain.clock.open ? "OPEN" : "CLOSED"} at block ${fmtBlock(chain.block)}${ageSec !== null ? `, in a snapshot ${fmtDuration(ageSec)} old` : ""}.`
      : `No live clock reading for ${chainName(chainId)}.`;
  } else if (id === "rulebook") {
    liveLine = chain?.healthy && chain.rules
      ? `${chainName(chainId)}, wildcard asset: ${CLASSES.map((c) => {
          const r = chain.rules?.[c];
          if (!isRuleOk(r)) return `${c} ${r ? "read error" : "—"}`;
          const p = fmtParamShort(r.action, r.param);
          return `${c} ${r.action}${p ? ` ${p}` : ""}`;
        }).join(", ")}.`
      : `No live rules for ${chainName(chainId)}.`;
  } else if (id === "oracle") {
    liveLine = sig?.lastLivePrint
      ? `${sig.feed} ${fmtPrice(sig.lastLivePrint.price)}${staleness !== null ? `, last print ${fmtDuration(staleness)} old` : ""}: Chainlink on Robinhood Chain mainnet, via the Signal API. On Robinhood Chain testnet the deployed GuardedFeed wraps a mock TSLA/rUSDG feed.`
      : "No live price from the Signal API right now.";
  }
  return (
    <section aria-labelledby="pipe-detail-title" className="grid gap-4 border-y border-ink py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-8">
      <div className="space-y-2">
        <h4 id="pipe-detail-title" className="flex items-center gap-2 font-mono text-[15px] font-semibold">
          <LiveDot live={d.live} /> {d.title}
        </h4>
        <p className="prose-col text-ink-2">{d.what}</p>
        {d.live ? (
          liveLine ? <p className="prose-col text-[15px] text-ink">{liveLine}</p> : null
        ) : (
          <p className="text-[14px] text-ink-2">Reference description. This contract&apos;s state isn&apos;t indexed.</p>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <pre tabIndex={0} className="data overflow-x-auto whitespace-pre-wrap break-words bg-bar/60 px-3 py-2">
          {d.signature}
        </pre>
        <p className="text-[14px]">
          Source: <a href={repoFile(d.source)}>{d.sourceLabel}</a>
        </p>
        {d.addresses ? <AddressRows kind={d.addresses} /> : null}
      </div>
    </section>
  );
}
