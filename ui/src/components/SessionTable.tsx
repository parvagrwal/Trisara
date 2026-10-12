"use client";

import type { CSSProperties, ReactNode } from "react";
import { Flash } from "./Flash";
import { Gauge } from "./Gauge";
import { DownGlyph, LockGlyph, OpenGlyph } from "./Glyphs";
import { Odometer } from "./Odometer";
import { Skel } from "./Skeleton";
import { Tip } from "./Tip";
import { CHAINS, type ChainInfo } from "@/data/chains";
import { CHAIN_LAG_BAD_SEC, CHAIN_LAG_WARN_SEC, LATENCY_GAUGE_MAX_MS } from "@/lib/config";
import { fmtBlock, fmtDuration, fmtLatency, fmtUtcTime, unixMs } from "@/lib/format";
import type { ChainState, IndexerState } from "@/lib/types";

const th = "px-2.5 pb-1.5 pt-1 text-left font-normal text-platen-dim";
const td = "px-2.5 py-2 align-top";
const LAG_TIP = "The chain's latest block is this old. The testnet may be stalled.";

export function SessionSkeleton() {
  return (
    <table className="data w-full">
      <tbody>
        {CHAINS.map((c, i) => (
          <tr key={c.id} data-skeleton="" className={i % 2 ? "bg-platen-band" : ""}>
            {["5ch", "13ch", "8ch", "11ch", "11ch", "7ch"].map((w, j) => (
              <td key={j} className={`${td} ${j > 2 ? "hidden sm:table-cell" : ""}`}>
                <Skel w={w} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Row =
  | { kind: "missing"; c: ChainInfo }
  | { kind: "down"; c: ChainInfo; error: string; polled: string }
  | { kind: "ok"; c: ChainInfo; clock: ReactNode; block: ReactNode; chainTime: ReactNode; latency: ReactNode; polled: string };

function buildRow(c: ChainInfo, chain: ChainState | undefined, now: number, hasChainTime: boolean): Row {
  if (!chain) return { kind: "missing", c };
  const polledAge = now ? (now - Date.parse(chain.polledAt)) / 1000 : null;
  const polled = polledAge === null ? "—" : `${fmtDuration(polledAge)} ago`;
  if (!chain.healthy) return { kind: "down", c, error: chain.error ?? "The indexer gave no error text.", polled };

  const open = chain.clock?.open;
  const atMs = unixMs(chain.clock?.at);
  const btsMs = unixMs(chain.blockTimestamp);
  const lag = btsMs !== null ? (Date.parse(chain.polledAt) - btsMs) / 1000 : null;
  const lagTone =
    lag === null ? "" : lag >= CHAIN_LAG_BAD_SEC ? "text-halt-t" : lag >= CHAIN_LAG_WARN_SEC ? "text-defer-t" : "text-platen-dim";
  const lat = Number.isFinite(chain.latencyMs) ? chain.latencyMs : null;

  const clock = (
    <>
      <Flash value={open === undefined ? undefined : String(open)} className="-mx-1 inline-block px-1">
        {open === undefined ? (
          "—"
        ) : (
          <span className={`inline-flex items-center gap-1.5 font-semibold ${open ? "text-allow-t" : "text-platen-text"}`}>
            {open ? <OpenGlyph size={10} /> : <LockGlyph size={10} />}
            {open ? "OPEN" : "CLOSED"}
          </span>
        )}
      </Flash>
      {/* Old poller: clock.at is wall-clock read time. New poller: shown as chain time instead. */}
      {!hasChainTime && atMs !== null ? <span className="block text-[11.5px] text-platen-dim">read at {fmtUtcTime(atMs)} UTC</span> : null}
    </>
  );
  const block = (
    <Flash value={chain.block} className="-mx-1 inline-block px-1">
      <Odometer value={fmtBlock(chain.block)} />
    </Flash>
  );
  const chainTime =
    btsMs === null ? (
      "—"
    ) : (
      <>
        <span>{fmtUtcTime(btsMs)} UTC</span>
        {lag !== null ? (
          <Tip content={LAG_TIP}>
            <span className={`block text-[11.5px] ${lagTone}`}>
              {lag >= CHAIN_LAG_WARN_SEC ? `chain time ${fmtDuration(lag)} behind: the testnet may be stalled` : `${fmtDuration(lag)} behind`}
            </span>
          </Tip>
        ) : null}
      </>
    );
  const latency = (
    <span className="inline-flex items-center gap-2">
      <Gauge
        value={lat}
        max={LATENCY_GAUGE_MAX_MS}
        tone={lat !== null && lat > 2000 ? "warn" : "neutral"}
        label={`${fmtLatency(lat)} of a 3,000 ms scale`}
      />
      <Flash value={lat === null ? undefined : lat} className="tnum">
        {fmtLatency(lat)}
      </Flash>
    </span>
  );
  return { kind: "ok", c, clock, block, chainTime, latency, polled };
}

function DownNote({ error, wide }: { error: string; wide: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-halt-t">
      <DownGlyph size={10} />
      <span className="font-semibold">down</span>
      <Tip content={error}>
        <span className={`block truncate text-platen-dim ${wide ? "max-w-[34ch]" : "max-w-[22ch]"}`}>{error}</span>
      </Tip>
    </span>
  );
}

export function SessionTable({ data, now, boot }: { data: IndexerState; now: number; boot: boolean }) {
  // Chain time exists only on the new poller (trap 13). Without it, clock.at is "read at".
  const hasChainTime = Object.values(data.chains).some((c) => c.blockTimestamp);
  const rows = CHAINS.map((c) => buildRow(c, data.chains[c.id], now, hasChainTime));
  const printStyle = (i: number): CSSProperties | undefined => (boot ? { animationDelay: `${(i + 1) * 60}ms` } : undefined);
  const span = hasChainTime ? 5 : 4;

  return (
    <>
      {/* 640px and up: the ruled table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="data w-full whitespace-nowrap">
          <caption className="sr-only">Session state per chain, read by the indexer</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>id</th>
              <th scope="col" className={th}>chain</th>
              <th scope="col" className={th}>clock</th>
              <th scope="col" className={`${th} text-right`}>block</th>
              {hasChainTime ? <th scope="col" className={th}>chain time</th> : null}
              <th scope="col" className={th}>rpc latency</th>
              <th scope="col" className={`${th} text-right`}>polled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cls = `${i % 2 === 1 ? "bg-platen-band" : ""} ${boot ? "print-row" : ""}`;
              const head = (
                <>
                  <td className={`${td} text-platen-dim`}>{r.c.id}</td>
                  <td className={td}>{r.c.name}</td>
                </>
              );
              if (r.kind === "missing") {
                return (
                  <tr key={r.c.id} className={cls} style={printStyle(i)}>
                    {head}
                    <td className={`${td} text-platen-dim`} colSpan={span}>
                      not in this snapshot
                    </td>
                  </tr>
                );
              }
              if (r.kind === "down") {
                return (
                  <tr key={r.c.id} className={cls} style={printStyle(i)}>
                    {head}
                    <td className={td} colSpan={span - 1}>
                      <DownNote error={r.error} wide />
                    </td>
                    <td className={`${td} text-right text-platen-dim`}>{r.polled}</td>
                  </tr>
                );
              }
              return (
                <tr key={r.c.id} className={cls} style={printStyle(i)}>
                  {head}
                  <td className={td}>{r.clock}</td>
                  <td className={`${td} text-right`}>{r.block}</td>
                  {hasChainTime ? <td className={td}>{r.chainTime}</td> : null}
                  <td className={td}>{r.latency}</td>
                  <td className={`${td} text-right text-platen-dim`}>{r.polled}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Under 640px: one stacked block per chain */}
      <ul className="data divide-y divide-platen-rule sm:hidden" aria-label="Session state per chain, read by the indexer">
        {rows.map((r, i) => (
          <li key={r.c.id} className={`space-y-1.5 py-2.5 ${boot ? "print-row" : ""}`} style={printStyle(i)}>
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="text-platen-dim">{r.c.id}</span> <span className="font-semibold">{r.c.name}</span>
              </span>
              {r.kind === "ok" ? <span className="text-right">{r.clock}</span> : null}
            </div>
            {r.kind === "missing" ? <p className="text-platen-dim">not in this snapshot</p> : null}
            {r.kind === "down" ? (
              <p>
                <DownNote error={r.error} wide={false} /> <span className="text-platen-dim">polled {r.polled}</span>
              </p>
            ) : null}
            {r.kind === "ok" ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <dt className="text-platen-dim">block</dt>
                  <dd>{r.block}</dd>
                </div>
                <div>
                  <dt className="text-platen-dim">rpc latency</dt>
                  <dd>{r.latency}</dd>
                </div>
                <div>
                  <dt className="text-platen-dim">polled</dt>
                  <dd>{r.polled}</dd>
                </div>
                {hasChainTime ? (
                  <div>
                    <dt className="text-platen-dim">chain time</dt>
                    <dd>{r.chainTime}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
