import {
  CLASSES,
  FEEDS,
  type ActionName,
  type ChainState,
  type FeedSymbol,
  type IndexerState,
  type Rule,
  type Signal,
  type SignalState,
  ACTIONS,
} from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const decimal = (v: unknown): string | undefined => (typeof v === "string" && /^\d+$/.test(v) ? v : undefined);
const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const parsesAsDate = (v: string | undefined) => v !== undefined && !Number.isNaN(Date.parse(v));

/** Accepts ALLOW..HALT, UNKNOWN(n), and the Signal API's ACTION_n fallback. */
export function toAction(v: unknown): ActionName | null {
  if (typeof v !== "string") return null;
  if ((ACTIONS as readonly string[]).includes(v)) return v as ActionName;
  const m = /^(?:UNKNOWN\((\d+)\)|ACTION_(\d+))$/.exec(v);
  if (m) return `UNKNOWN(${Number(m[1] ?? m[2])})`;
  return null;
}

// ---------------------------------------------------------------- indexer

export type IndexerParse =
  | { ok: true; data: IndexerState }
  | { ok: false; kind: "schema"; version: unknown }
  | { ok: false; kind: "shape"; message: string };

export const SUPPORTED_SCHEMA = 2;

function normalizeRule(v: unknown): Rule | undefined {
  if (!isObj(v)) return undefined;
  if (typeof v.error === "string") return { error: v.error };
  const action = toAction(v.action);
  if (!action) return { error: `unrecognized action ${JSON.stringify(v.action)}` };
  const param = decimal(v.param) ?? (finite(v.param) !== undefined ? String(v.param) : undefined);
  return { action, param: param ?? "0", reason: str(v.reason) ?? "" };
}

function normalizeChain(key: string, v: unknown, ts: string): ChainState {
  if (!isObj(v)) {
    return { chainId: key, name: key, healthy: false, polledAt: ts, latencyMs: Number.NaN, error: "malformed chain entry in the snapshot" };
  }
  const chain: ChainState = {
    chainId: str(v.chainId) ?? key,
    name: str(v.name) ?? key,
    healthy: v.healthy === true,
    polledAt: parsesAsDate(str(v.polledAt)) ? (v.polledAt as string) : ts,
    latencyMs: finite(v.latencyMs) ?? Number.NaN,
  };
  // An entry without a healthy flag (pre-v2 shape) carries its error, if any.
  if (typeof v.error === "string") chain.error = v.error.slice(0, 400);
  if (typeof v.healthy !== "boolean" && !chain.error) chain.error = "snapshot entry has no healthy flag";
  const block = decimal(v.block);
  if (block) chain.block = block;
  const bts = decimal(v.blockTimestamp);
  if (bts) chain.blockTimestamp = bts;
  if (isObj(v.clock) && typeof v.clock.open === "boolean") {
    chain.clock = { open: v.clock.open, anchor: "EQUITY_US", at: decimal(v.clock.at) ?? "" };
  }
  if (isObj(v.rules)) {
    const rules: Partial<Record<(typeof CLASSES)[number], Rule>> = {};
    for (const cls of CLASSES) {
      const r = normalizeRule(v.rules[cls]);
      if (r) rules[cls] = r;
    }
    chain.rules = rules;
  }
  return chain;
}

export function normalizeIndexer(json: unknown): IndexerParse {
  if (!isObj(json)) return { ok: false, kind: "shape", message: "the response is not a JSON object" };
  if (json.schemaVersion !== SUPPORTED_SCHEMA) return { ok: false, kind: "schema", version: json.schemaVersion };
  const ts = str(json.ts);
  if (!parsesAsDate(ts)) return { ok: false, kind: "shape", message: "the snapshot has no valid ts" };
  if (!isObj(json.chains)) return { ok: false, kind: "shape", message: "the snapshot has no chains object" };
  const chains: Record<string, ChainState> = {};
  for (const [key, value] of Object.entries(json.chains)) chains[key] = normalizeChain(key, value, ts as string);
  return { ok: true, data: { schemaVersion: SUPPORTED_SCHEMA, ts: ts as string, chains } };
}

// ---------------------------------------------------------------- signal API

export type SignalParse = { ok: true; data: SignalState; problems: string[] } | { ok: false; message: string };

function normalizeSignal(key: string, v: unknown): Signal | string {
  if (!isObj(v)) return `${key}: not an object`;
  const keyChain = key.includes("/") ? key.split("/")[0] ?? null : null;
  const chainId = str(v.chain_id) ?? keyChain ?? null;
  const feed = (str(v.feed) ?? key.split("/").pop() ?? "").toUpperCase();
  if (!(FEEDS as readonly string[]).includes(feed)) return `${key}: unknown feed ${JSON.stringify(v.feed)}`;
  const anchorState = v.anchor_state === "OPEN" || v.anchor_state === "CLOSED" ? v.anchor_state : null;
  if (!anchorState) return `${key}: anchor_state is ${JSON.stringify(v.anchor_state)}`;
  const action = toAction(v.action);
  if (!action) return `${key}: action is ${JSON.stringify(v.action)}`;
  const asOf = str(v.as_of);
  if (!parsesAsDate(asOf)) return `${key}: as_of is missing`;

  let lastLivePrint: Signal["lastLivePrint"] = null;
  if (isObj(v.last_live_print)) {
    const price = finite(v.last_live_print.price);
    const updatedAt = str(v.last_live_print.updated_at);
    if (price !== undefined && parsesAsDate(updatedAt)) lastLivePrint = { price, updatedAt: updatedAt as string };
  }
  const signal: Signal = {
    chainId,
    feed: feed as FeedSymbol,
    anchorState,
    clockSource: v.clock_source === "pilot-fallback" ? "pilot-fallback" : "onchain",
    asOf: asOf as string,
    lastLivePrint,
    stalenessSec: finite(v.staleness_sec) ?? null,
    action,
    reason: str(v.reason) ?? "",
    resumesAt: parsesAsDate(str(v.resumes_at)) ? (v.resumes_at as string) : null,
  };
  const param = finite(v.rule_param);
  if (param !== undefined) signal.ruleParam = param;
  if (v.rule_source === "onchain" || v.rule_source === "pilot-fallback") signal.ruleSource = v.rule_source;
  if (typeof v.note === "string") signal.note = v.note;
  return signal;
}

export function normalizeSignals(json: unknown): SignalParse {
  if (!isObj(json)) return { ok: false, message: "the response is not a JSON object" };
  if (!isObj(json.signals)) return { ok: false, message: "the response has no signals object" };
  const signals: Signal[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(json.signals)) {
    const s = normalizeSignal(key, value);
    if (typeof s === "string") problems.push(s);
    else signals.push(s);
  }
  const order = (s: Signal) => FEEDS.indexOf(s.feed);
  signals.sort((a, b) => (a.chainId ?? "").localeCompare(b.chainId ?? "") || order(a) - order(b));
  const shape = signals.some((s) => s.chainId !== null) ? "multi" : "legacy";
  const generatedAt = parsesAsDate(str(json.generated_at)) ? (json.generated_at as string) : null;
  return { ok: true, data: { generatedAt, shape, signals }, problems };
}

/** Signals for one chain. Legacy entries count as Robinhood Chain 46630 (the API's documented default). */
export function signalsFor(state: SignalState | null, chainId: string): Signal[] {
  if (!state) return [];
  return state.signals.filter((s) => (s.chainId ?? "46630") === chainId);
}

/** Chain ids the Signal API actually serves. */
export function signalChains(state: SignalState | null): string[] {
  if (!state) return [];
  return [...new Set(state.signals.map((s) => s.chainId ?? "46630"))];
}
