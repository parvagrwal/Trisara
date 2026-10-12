"use client";

import { useIndexer, useNow } from "@/lib/live";
import { useReducedMotion } from "@/lib/ui";

// A three-spoked escape wheel with 15 slanted teeth. The shape repeats every
// 120 degrees (5 teeth), so a tooth advance is (k mod 5) * 24 degrees.
const TEETH = 15;
const R_OUT = 10.6;
const R_IN = 8.2;
const r2 = (n: number) => Math.round(n * 100) / 100;

function wheelPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < TEETH; i++) {
    const a0 = (i / TEETH) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / TEETH;
    // Root, then a slanted rise to the tip, then a straight drop: a saw tooth.
    const tip = a0 + ((a1 - a0) * 0.72);
    pts.push(`${r2(12 + R_IN * Math.cos(a0))} ${r2(12 + R_IN * Math.sin(a0))}`);
    pts.push(`${r2(12 + R_OUT * Math.cos(tip))} ${r2(12 + R_OUT * Math.sin(tip))}`);
    pts.push(`${r2(12 + R_IN * Math.cos(tip + 0.06))} ${r2(12 + R_IN * Math.sin(tip + 0.06))}`);
  }
  return `M${pts.join("L")}Z`;
}

const WHEEL = wheelPath();
const SPOKES = [0, 120, 240].map((deg) => {
  const a = (deg * Math.PI) / 180 - Math.PI / 2;
  return { x: r2(12 + 6.6 * Math.cos(a)), y: r2(12 + 6.6 * Math.sin(a)) };
});

/** 22px escape wheel. Advances one tooth per second only while at least one chain's clock reads open. */
export function Mark({ size = 22 }: { size?: number }) {
  const indexer = useIndexer();
  const now = useNow();
  const reduced = useReducedMotion();
  const anyOpen = Object.values(indexer.data?.chains ?? {}).some((c) => c.healthy && c.clock?.open);
  const k = anyOpen && !reduced && now ? Math.floor(now / 1000) % 5 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0 text-ink">
      <g transform={`rotate(${k * 24} 12 12)`}>
        <path d={WHEEL} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        {SPOKES.map((s, i) => (
          <line key={i} x1="12" y1="12" x2={s.x} y2={s.y} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ))}
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </g>
    </svg>
  );
}
