// Weekend 1 freeze and thaw, Oct 3 to 5, 2026.
// Source: reports/weekend-1-oct3-4.md (every constant below is from that file).
// The logger files behind the report are not in the repo, so there is no
// per-minute series here and none is drawn.

export const REPORT_PATH = "reports/weekend-1-oct3-4.md";

export const WINDOW = { start: "2026-10-03T10:05:00Z", end: "2026-10-05T16:05:00Z" } as const;
export const FREEZE = { start: "2026-10-03T10:17:00Z", end: "2026-10-05T00:00:00Z", hours: 37.7 } as const;
/** Sparse small moves after the freeze, until about the first live print. */
export const SPARSE = { start: "2026-10-05T00:00:00Z", end: "2026-10-05T12:56:00Z" } as const;
export const BELL = "2026-10-05T13:30:00Z"; // NYSE open that day (EDT)
export const BLOCKS = { from: 79_006_300, to: 80_345_978 } as const; // Robinhood Chain mainnet

export interface Thaw {
  symbol: "AAPL" | "NVDA" | "TSLA";
  /** Approximate first live update (report: IST times, converted to UTC). */
  firstLive: string;
  fridayPrint: number;
  firstLivePrice: number;
}

export const THAWS: readonly Thaw[] = [
  { symbol: "AAPL", firstLive: "2026-10-05T12:56:56Z", fridayPrint: 333.8239, firstLivePrice: 331.7627 },
  { symbol: "NVDA", firstLive: "2026-10-05T13:28:20Z", fridayPrint: 234.9971, firstLivePrice: 236.4912 },
  { symbol: "TSLA", firstLive: "2026-10-05T13:31:30Z", fridayPrint: 370.448, firstLivePrice: 366.486 },
];

/** Gap of the first live print versus Friday's frozen print, in percent (computed, not quoted). */
export const gapPct = (t: Thaw) => ((t.firstLivePrice - t.fridayPrint) / t.fridayPrint) * 100;

export const fmtGap = (pct: number, digits = 2) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(digits)}%`;

/** Minutes between the first and last thaw. */
export const thawSpreadMin = () => {
  const ts = THAWS.map((t) => Date.parse(t.firstLive));
  return (Math.max(...ts) - Math.min(...ts)) / 60_000;
};
