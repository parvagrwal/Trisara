import { isKnownAction, isRuleOk, type ActionName, type ClassName, type Rule } from "./types";

const toBig = (s: string | undefined): bigint | null => {
  if (s === undefined || !/^\d+$/.test(s)) return null;
  return BigInt(s);
};

const toNum = (s: string | number | undefined): number | null => {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const b = toBig(s);
  return b === null ? null : Number(b);
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 45s, 12m 04s, 12h 58m, 2d 03h. Negative values clamp to 0. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86400)}d ${pad2(Math.floor((s % 86400) / 3600))}h`;
}

/** Rule durations: 1h, 30m, 45s, 1h 30m. */
export function fmtSpan(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [h ? `${h}h` : "", m ? `${m}m` : "", r ? `${r}s` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "0s";
}

/** 1 hour, 30 minutes, 45 seconds, 1 hour 30 minutes. */
export function fmtSpanWords(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const word = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const parts = [h ? word(h, "hour") : "", m ? word(m, "minute") : "", r ? word(r, "second") : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "0 seconds";
}

/** bps to percent with two decimals: 500 -> "5.00". */
export const bpsFixed = (bps: number) => (bps / 100).toFixed(2);
/** bps to percent, trailing zeros dropped: 500 -> "5", 250 -> "2.5". */
export const bpsTrim = (bps: number) => String(Number((bps / 100).toFixed(2)));

/** COLLAR ±5.00%, CAP max 10.00%, DEFER defer up to 1h. ALLOW, HALT and unknown: "". */
export function fmtParam(action: ActionName, param: string | number | undefined): string {
  const n = toNum(param);
  if (n === null) return "";
  if (action === "COLLAR") return `±${bpsFixed(n)}%`;
  if (action === "CAP") return `max ${bpsFixed(n)}%`;
  if (action === "DEFER") return `defer up to ${fmtSpan(n)}`;
  return "";
}

/** Compact form for the change log: ±5%, max 10%, 1h. */
export function fmtParamShort(action: ActionName, param: string | number | undefined): string {
  const n = toNum(param);
  if (n === null) return "";
  if (action === "COLLAR") return `±${bpsTrim(n)}%`;
  if (action === "CAP") return `max ${bpsTrim(n)}%`;
  if (action === "DEFER") return fmtSpan(n);
  return "";
}

export const fmtPrice = (p: number) => `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtPriceFull = (p: number) => `$${p.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

/** 133513130 -> 133,513,130 */
export function fmtBlock(block: string | undefined): string {
  const b = toBig(block);
  return b === null ? "—" : b.toLocaleString("en-US");
}

export const fmtLatency = (ms: number | null | undefined) =>
  ms === null || ms === undefined || !Number.isFinite(ms) ? "—" : `${Math.round(ms).toLocaleString("en-US")} ms`;

/** Unix seconds (decimal string) to epoch ms. */
export function unixMs(s: string | undefined): number | null {
  const b = toBig(s);
  return b === null ? null : Number(b) * 1000;
}

/** 08:36:02 (UTC) */
export function fmtUtcTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** 2026-10-12 08:36:02 UTC */
export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${fmtUtcTime(ms)} UTC`;
}

/** Local wall-clock time for the change log. */
export function fmtLocalTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** The bytes32 a Rulebook reason code is stored as, for comparing with cast output. */
export function reasonBytes32(reason: string): string {
  let hex = "";
  for (const ch of reason) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0").slice(0, 64)}`;
}

/** Middle-truncated address for tight cells: 0x7998…f1c6 */
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ---------------------------------------------------------------- plain English

export const CLASS_NOUN: Record<ClassName, string> = {
  SWAP: "Swaps",
  BORROW: "Borrowing",
  LIQUIDATE: "Liquidations",
  SETTLE: "Settlements",
};

/** One generated sentence per class (the view indexer/UI_CONTRACT.md asks for). */
export function plainEnglish(cls: ClassName, rule: Rule | undefined): string {
  const noun = CLASS_NOUN[cls];
  if (!rule) return `${noun}: the indexer has no reading.`;
  if (!isRuleOk(rule)) return `${noun}: the rule couldn't be read.`;
  const n = toNum(rule.param) ?? 0;
  switch (rule.action) {
    case "ALLOW":
      return `${noun} allowed.`;
    case "CAP":
      return `${noun} capped at ${bpsTrim(n)}%.`;
    case "COLLAR":
      return `${noun} limited to ±${bpsTrim(n)}% bands.`;
    case "DEFER":
      return `${noun} deferred up to ${fmtSpanWords(n)}.`;
    case "HALT":
      if (rule.reason === "NO_RULE") return `${noun} halted: no rule is published (default deny).`;
      if (rule.reason === "RULE_EXPIRED") return `${noun} halted: the published rule expired.`;
      return `${noun} halted (${rule.reason || "no reason given"}).`;
    default:
      return isKnownAction(rule.action) ? `${noun}: ${rule.action}.` : `${noun}: ${rule.action}, an action this page doesn't know.`;
  }
}
