"use client";

import { useId, useRef } from "react";
import { BELL, FREEZE, SPARSE, THAWS, WINDOW, fmtGap, gapPct } from "@/data/weekend1";
import { useSeenOnce } from "@/lib/ui";

// Static timeline drawn from src/data/weekend1.ts, never from a fetch.

const T0 = Date.parse(WINDOW.start);
const T1 = Date.parse(WINDOW.end);
const H = 3_600_000;
const freezeHours = ((Date.parse(FREEZE.end) - Date.parse(FREEZE.start)) / H).toFixed(1);

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (ms: number) => `${pad2(new Date(ms).getUTCHours())}:${pad2(new Date(ms).getUTCMinutes())}Z`;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ms: number) => `${MONTH[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;

/** Every 12 hours on the UTC 00:00 and 12:00 boundaries inside the window. */
const TICKS: number[] = [];
for (let t = Math.ceil(T0 / (12 * H)) * 12 * H; t <= T1; t += 12 * H) TICKS.push(t);

const DESC =
  `Robinhood Chain mainnet Chainlink feeds, ${WINDOW.start} to ${WINDOW.end}. ` +
  `No new round from ${FREEZE.start} to ${FREEZE.end} (${freezeHours} hours). ` +
  `Sparse small moves from ${SPARSE.start} to about ${SPARSE.end}. ` +
  THAWS.map((t) => `${t.symbol} first live print about ${hhmm(Date.parse(t.firstLive))}, ${fmtGap(gapPct(t))} versus Friday's print`).join("; ") +
  `. NYSE bell at ${hhmm(Date.parse(BELL))}.`;

function Timeline({ width, narrow }: { width: number; narrow: boolean }) {
  const pattern = useId().replace(/:/g, "");
  const titleId = `${pattern}-t`;
  const descId = `${pattern}-d`;
  const padX = 8;
  const x = (iso: string | number) => {
    const t = typeof iso === "number" ? iso : Date.parse(iso);
    return padX + ((t - T0) / (T1 - T0)) * (width - 2 * padX);
  };
  const labelRows = narrow ? [16, 32, 48] : [14, 29, 44];
  const bandTop = narrow ? 70 : 56;
  const bandH = narrow ? 30 : 30;
  const axisY = bandTop + bandH + 6;
  const height = narrow ? axisY + 66 : axisY + 38;
  const fs = narrow ? 10.5 : 11;
  const labelX = x(THAWS[0]!.firstLive) - (narrow ? 12 : 14);
  return (
    <svg
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="block font-mono [font-stretch:87.5%]"
    >
      <title id={titleId}>Weekend 1 freeze and thaw timeline</title>
      <desc id={descId}>{DESC}</desc>
      <defs>
        <pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--color-bar)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-ink-3)" strokeWidth="1.6" />
        </pattern>
      </defs>

      {/* freeze band */}
      <rect x={x(FREEZE.start)} y={bandTop} width={x(FREEZE.end) - x(FREEZE.start)} height={bandH} fill={`url(#${pattern})`} stroke="var(--color-ink)" strokeWidth="1" />
      <rect
        x={(x(FREEZE.start) + x(FREEZE.end)) / 2 - (narrow ? 74 : 82)}
        y={bandTop + 7}
        width={narrow ? 148 : 164}
        height={bandH - 14}
        fill="var(--color-fanfold)"
      />
      <text x={(x(FREEZE.start) + x(FREEZE.end)) / 2} y={bandTop + bandH / 2 + 4} textAnchor="middle" fontSize={fs} fill="var(--color-ink)" fontWeight="600">
        no new round, {freezeHours} h
      </text>

      {/* sparse moves band */}
      <rect x={x(SPARSE.start)} y={bandTop} width={x(SPARSE.end) - x(SPARSE.start)} height={bandH} fill="var(--color-bar)" stroke="var(--color-ink-3)" strokeWidth="1" strokeDasharray="3 2" />
      <text x={(x(SPARSE.start) + x(SPARSE.end)) / 2} y={bandTop + bandH / 2 + 4} textAnchor="middle" fontSize={fs - 0.5} fill="var(--color-ink-2)">
        {narrow ? "sparse" : "sparse small moves"}
      </text>

      {/* axis and ticks */}
      <line x1={padX} x2={width - padX} y1={axisY} y2={axisY} stroke="var(--color-ink)" strokeWidth="1" />
      {TICKS.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={axisY} y2={axisY + 5} stroke="var(--color-ink)" />
          {narrow ? (
            <text x={x(t)} y={axisY + 17} textAnchor="middle" fontSize={fs - 0.5} fill="var(--color-ink-2)">
              <tspan x={x(t)}>{day(t)}</tspan>
              <tspan x={x(t)} dy="12">
                {hhmm(t)}
              </tspan>
            </text>
          ) : (
            <text x={x(t)} y={axisY + 17} textAnchor="middle" fontSize={fs} fill="var(--color-ink-2)">
              {day(t)} {hhmm(t)}
            </text>
          )}
        </g>
      ))}

      {/* NYSE bell */}
      <line x1={x(BELL)} x2={x(BELL)} y1={bandTop - 6} y2={axisY} stroke="var(--color-ink)" strokeWidth="0.75" strokeDasharray="2 2" />
      <text x={width - padX} y={axisY + (narrow ? 46 : 31)} textAnchor="end" fontSize={fs - 0.5} fill="var(--color-ink)">
        NYSE bell {hhmm(Date.parse(BELL))}
      </text>

      {/* thaw ticks, labels staggered so they never collide */}
      {THAWS.map((t, i) => {
        const tx = x(t.firstLive);
        const ly = labelRows[i]!;
        return (
          <g key={t.symbol}>
            <line x1={tx} x2={tx} y1={bandTop - 2} y2={bandTop + bandH} stroke="var(--color-ink)" strokeWidth="2" />
            <polyline
              points={`${tx},${bandTop - 2} ${tx},${ly + 4} ${labelX + 4},${ly + 4}`}
              fill="none"
              stroke="var(--color-ink-3)"
              strokeWidth="0.75"
            />
            <text x={labelX} y={ly + 7} textAnchor="end" fontSize={fs} fill="var(--color-ink)">
              <tspan fontWeight="600">{t.symbol}</tspan> {hhmm(Date.parse(t.firstLive))}{" "}
              <tspan fill="var(--color-ink-2)">{fmtGap(gapPct(t))}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function FreezeTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  return (
    <figure ref={ref} className="space-y-2">
      <div className={`reveal-x ${seen ? "is-grown" : ""} hidden sm:block`}>
        <Timeline width={1072} narrow={false} />
      </div>
      <div className={`reveal-x ${seen ? "is-grown" : ""} sm:hidden`}>
        <Timeline width={360} narrow />
      </div>
      <figcaption className="text-[13px] text-ink-2">
        Times in UTC, from the weekend report. Gaps are computed here from the report&apos;s Friday and first live prices. The
        logger files are not in the repo, so no per-minute series is drawn.
      </figcaption>
      <div className="sr-only">
      <table>
        <caption>First live prints after the freeze</caption>
        <thead>
          <tr>
            <th scope="col">feed</th>
            <th scope="col">first live print (UTC)</th>
            <th scope="col">Friday print</th>
            <th scope="col">first live price</th>
            <th scope="col">gap</th>
          </tr>
        </thead>
        <tbody>
          {THAWS.map((t) => (
            <tr key={t.symbol}>
              <td>{t.symbol}</td>
              <td>{hhmm(Date.parse(t.firstLive))}</td>
              <td>{t.fridayPrint}</td>
              <td>{t.firstLivePrice}</td>
              <td>{fmtGap(gapPct(t))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
