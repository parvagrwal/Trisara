// Client-side live data: one shared 1 Hz clock, two pollers (indexer and
// Signal API), the change log and the screen-reader announcer. Module-level
// stores read through useSyncExternalStore, so every client island shares one
// set of requests and one clock.

import { useSyncExternalStore } from "react";
import {
  BACKOFF_MS,
  FIRST_TIMEOUT_MS,
  INDEXER_STATE_URL,
  LATE_AFTER_SEC,
  NEXT_TIMEOUT_MS,
  POLL_MS,
  SIGNAL_STATE_URL,
  WAKING_AFTER_MS,
  WARMING_RETRY_MS,
} from "./config";
import { normalizeIndexer, normalizeSignals } from "./normalize";
import { CLASSES, isRuleOk, type IndexerState, type Rule, type SignalState } from "./types";
import { chainName } from "@/data/chains";
import { fmtDuration, fmtParamShort } from "./format";

// ---------------------------------------------------------------- shared clock

let nowMs = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTick() {
  const delay = 1000 - (Date.now() % 1000) + 8;
  clockTimer = setTimeout(() => {
    nowMs = Date.now();
    clockListeners.forEach((l) => l());
    scheduleTick();
  }, delay);
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (clockTimer === null) {
    nowMs = Date.now();
    scheduleTick();
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearTimeout(clockTimer);
      clockTimer = null;
    }
  };
}

/** Milliseconds since the epoch, updated once per second. 0 during prerender and hydration. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, () => nowMs, () => 0);
}

// ---------------------------------------------------------------- source state

export type SourceId = "indexer" | "signal";
export type Status = "loading" | "waking" | "warming" | "ok" | "stale" | "error";
export type FailureKind = "timeout" | "network" | "http" | "parse" | "shape";

export interface Failure {
  kind: FailureKind;
  status?: number;
  message: string;
  at: number;
}

export interface RawBody {
  body: string;
  status: number | null;
  at: number;
}

export interface SourceState<T> {
  id: SourceId;
  url: string;
  data: T | null;
  /** Client time of the last good response. */
  dataAt: number | null;
  /** Client time of the first good response in this page view (drives the boot print). */
  firstDataAt: number | null;
  /** Duration of the last completed request. */
  latencyMs: number | null;
  /** The last response body received, good or bad. */
  raw: RawBody | null;
  /** Set while the latest request failed; cleared by the next success. */
  failure: Failure | null;
  /** The latest response was the indexer's 503 warm-up body. */
  warming: boolean;
  /** The latest response had a schemaVersion this page doesn't understand. */
  schema: { version: unknown } | null;
  inFlightSince: number | null;
  firstStartedAt: number | null;
  failures: number;
  nextAttemptAt: number | null;
  problems: string[];
}

function initialState<T>(id: SourceId, url: string): SourceState<T> {
  return {
    id,
    url,
    data: null,
    dataAt: null,
    firstDataAt: null,
    latencyMs: null,
    raw: null,
    failure: null,
    warming: false,
    schema: null,
    inFlightSince: null,
    firstStartedAt: null,
    failures: 0,
    nextAttemptAt: null,
    problems: [],
  };
}

type Parsed<T> =
  | { ok: true; data: T; problems?: string[] }
  | { ok: false; schema: unknown }
  | { ok: false; message: string };

class Poller<T> {
  state: SourceState<T>;
  readonly initial: SourceState<T>;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  constructor(
    id: SourceId,
    url: string,
    private parse: (json: unknown) => Parsed<T>,
    private onData: (prev: T | null, next: T) => void,
  ) {
    this.initial = initialState<T>(id, url);
    this.state = this.initial;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    ensureStarted();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;
  getServerSnapshot = () => this.initial;

  private set(patch: Partial<SourceState<T>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
    notifyAny();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(ms: number) {
    this.clearTimer();
    if (!canPoll()) {
      if (this.state.nextAttemptAt !== null) this.set({ nextAttemptAt: null });
      return;
    }
    this.timer = setTimeout(() => void this.fetchNow(), ms);
    this.set({ nextAttemptAt: Date.now() + ms });
  }

  /** Request now unless a request is already in flight. */
  async fetchNow() {
    if (this.inFlight) return;
    this.clearTimer();
    this.inFlight = true;
    const started = Date.now();
    this.set({ inFlightSince: started, firstStartedAt: this.state.firstStartedAt ?? started, nextAttemptAt: null });

    const controller = new AbortController();
    // Cold start allowance until the first good response, then the normal timeout.
    const timeoutMs = this.state.data === null ? FIRST_TIMEOUT_MS : NEXT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

    let status: number;
    let body: string;
    try {
      // Plain GET, no query string, no custom headers: both servers route exact
      // paths and the indexer does not answer CORS preflights.
      const res = await fetch(this.state.url, { cache: "no-store", signal: controller.signal });
      status = res.status;
      body = await res.text();
    } catch (e) {
      clearTimeout(timeout);
      this.inFlight = false;
      const timedOut = controller.signal.aborted;
      this.fail({
        kind: timedOut ? "timeout" : "network",
        message: timedOut
          ? `no response within ${Math.round(timeoutMs / 1000)} s`
          : `network error (${e instanceof Error ? e.message : String(e)}): the host didn't answer, or the browser blocked the response`,
        at: Date.now(),
      });
      return;
    }
    clearTimeout(timeout);
    this.inFlight = false;

    const at = Date.now();
    const raw: RawBody = { body, status, at };
    const latencyMs = at - started;

    if (status === 503 && /warming up/i.test(body)) {
      this.set({ raw, latencyMs, warming: true, failure: null, inFlightSince: null, failures: 0 });
      this.schedule(WARMING_RETRY_MS);
      return;
    }
    if (status < 200 || status >= 300) {
      this.fail({ kind: "http", status, message: `HTTP ${status}`, at }, raw, latencyMs);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      this.fail({ kind: "parse", message: "the response is not JSON", at }, raw, latencyMs);
      return;
    }
    const parsed = this.parse(json);
    if (!parsed.ok) {
      if ("schema" in parsed) {
        this.set({ raw, latencyMs, schema: { version: parsed.schema }, warming: false, failure: null, inFlightSince: null, failures: 0 });
        this.schedule(POLL_MS);
      } else {
        this.fail({ kind: "shape", message: parsed.message, at }, raw, latencyMs);
      }
      return;
    }
    const prev = this.state.data;
    this.set({
      data: parsed.data,
      dataAt: at,
      firstDataAt: this.state.firstDataAt ?? at,
      raw,
      latencyMs,
      failure: null,
      warming: false,
      schema: null,
      inFlightSince: null,
      failures: 0,
      problems: parsed.problems ?? [],
    });
    this.onData(prev, parsed.data);
    this.schedule(POLL_MS);
  }

  private fail(failure: Failure, raw?: RawBody, latencyMs?: number) {
    const failures = this.state.failures + 1;
    const patch: Partial<SourceState<T>> = { failure, failures, inFlightSince: null, warming: false };
    if (raw) patch.raw = raw;
    if (latencyMs !== undefined) patch.latencyMs = latencyMs;
    this.set(patch);
    this.schedule(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)] ?? 60_000);
  }

  /** Called when polling is allowed again (unpause, tab visible). */
  resume() {
    void this.fetchNow();
  }

  halt() {
    this.clearTimer();
    if (this.state.nextAttemptAt !== null) this.set({ nextAttemptAt: null });
  }
}

// ---------------------------------------------------------------- age and status

export function indexerAgeSec(s: SourceState<IndexerState>, now: number): number | null {
  if (!s.data || !now) return null;
  return (now - Date.parse(s.data.ts)) / 1000;
}

export function signalAgeSec(s: SourceState<SignalState>, now: number): number | null {
  if (!s.data?.generatedAt || !now) return null;
  return (now - Date.parse(s.data.generatedAt)) / 1000;
}

/** Brief section 3.3. ageSec is the server snapshot age (null when unknown). */
export function deriveStatus(s: SourceState<unknown>, now: number, ageSec: number | null): Status {
  if (s.data === null) {
    if (s.schema) return "error";
    if (s.warming) return "warming";
    if (s.failure) return "error";
    const since = s.firstStartedAt;
    if (since !== null && now && now - since >= WAKING_AFTER_MS) return "waking";
    return "loading";
  }
  if (s.failure || s.warming || s.schema) return "stale";
  if (ageSec !== null && ageSec > LATE_AFTER_SEC) return "stale";
  return "ok";
}

// ---------------------------------------------------------------- change log and announcer

export interface ChangeEntry {
  id: number;
  at: number;
  text: string;
}

let changes: ChangeEntry[] = [];
let changeSeq = 0;
const changeListeners = new Set<() => void>();
const MAX_CHANGES = 50;

function logChange(text: string) {
  changes = [{ id: ++changeSeq, at: Date.now(), text }, ...changes].slice(0, MAX_CHANGES);
  changeListeners.forEach((l) => l());
}

const EMPTY_CHANGES: ChangeEntry[] = [];
export function useChanges(): ChangeEntry[] {
  return useSyncExternalStore(
    (l) => {
      changeListeners.add(l);
      return () => changeListeners.delete(l);
    },
    () => changes,
    () => EMPTY_CHANGES,
  );
}

let announcement = { id: 0, text: "" };
const announceListeners = new Set<() => void>();
const NO_ANNOUNCEMENT = { id: 0, text: "" };

function announce(text: string) {
  announcement = { id: announcement.id + 1, text };
  announceListeners.forEach((l) => l());
}

export function useAnnouncement() {
  return useSyncExternalStore(
    (l) => {
      announceListeners.add(l);
      return () => announceListeners.delete(l);
    },
    () => announcement,
    () => NO_ANNOUNCEMENT,
  );
}

function ruleText(r: Rule | undefined): string {
  if (!r) return "no reading";
  if (!isRuleOk(r)) return "read error";
  const p = fmtParamShort(r.action, r.param);
  return p ? `${r.action} ${p}` : r.action;
}

function diffIndexer(prev: IndexerState | null, next: IndexerState) {
  if (!prev) return;
  const said: string[] = [];
  for (const id of Object.keys(next.chains)) {
    const a = prev.chains[id];
    const b = next.chains[id];
    if (!a || !b) continue;
    const name = chainName(id);
    if (a.healthy !== b.healthy) {
      logChange(`${name}: ${a.healthy ? "reporting" : "down"} to ${b.healthy ? "reporting" : "down"}`);
    }
    if (a.clock && b.clock && a.clock.open !== b.clock.open) {
      logChange(`${name} clock: ${a.clock.open ? "OPEN" : "CLOSED"} to ${b.clock.open ? "OPEN" : "CLOSED"}`);
      said.push(`${name} clock is now ${b.clock.open ? "open" : "closed"}.`);
    }
    if (a.rules && b.rules) {
      for (const cls of CLASSES) {
        const before = ruleText(a.rules[cls]);
        const after = ruleText(b.rules[cls]);
        if (before !== after) {
          logChange(`${name}: ${cls} ${before} to ${after}`);
          const ra = a.rules[cls];
          const rb = b.rules[cls];
          if (isRuleOk(ra) && isRuleOk(rb) && ra.action !== rb.action) said.push(`${name} ${cls} is now ${rb.action}.`);
        }
      }
    }
  }
  if (said.length) announce(said.join(" "));
}

function diffSignals(prev: SignalState | null, next: SignalState) {
  if (!prev) return;
  const said: string[] = [];
  for (const b of next.signals) {
    const a = prev.signals.find((s) => s.chainId === b.chainId && s.feed === b.feed);
    if (!a) continue;
    const chain = chainName(b.chainId ?? "46630");
    if (a.action !== b.action || a.reason !== b.reason) {
      logChange(`${b.feed} signal on ${chain}: ${a.action} (${a.reason}) to ${b.action} (${b.reason})`);
      if (a.action !== b.action) said.push(`${b.feed} signal is now ${b.action}.`);
    }
  }
  if (said.length) announce(said.join(" "));
}

// ---------------------------------------------------------------- the two sources

const indexer = new Poller<IndexerState>(
  "indexer",
  INDEXER_STATE_URL,
  (json) => {
    const r = normalizeIndexer(json);
    if (r.ok) return { ok: true, data: r.data };
    if (r.kind === "schema") return { ok: false, schema: r.version };
    return { ok: false, message: r.message };
  },
  diffIndexer,
);

const signal = new Poller<SignalState>(
  "signal",
  SIGNAL_STATE_URL,
  (json) => {
    const r = normalizeSignals(json);
    return r.ok ? { ok: true, data: r.data, problems: r.problems } : { ok: false, message: r.message };
  },
  diffSignals,
);

const pollers = { indexer, signal } as const;

export function useIndexer(): SourceState<IndexerState> {
  return useSyncExternalStore(indexer.subscribe, indexer.getSnapshot, indexer.getServerSnapshot);
}

export function useSignal(): SourceState<SignalState> {
  return useSyncExternalStore(signal.subscribe, signal.getSnapshot, signal.getServerSnapshot);
}

export function retry(id: SourceId) {
  void pollers[id].fetchNow();
}

// ---------------------------------------------------------------- pause, visibility, lifecycle

let paused = false;
let started = false;
const controlListeners = new Set<() => void>();
const anyListeners = new Set<() => void>();
function notifyAny() {
  anyListeners.forEach((l) => l());
}

function canPoll() {
  return !paused && (typeof document === "undefined" || document.visibilityState === "visible");
}

export function setPaused(next: boolean) {
  if (paused === next) return;
  paused = next;
  controlListeners.forEach((l) => l());
  for (const p of Object.values(pollers)) {
    if (canPoll()) p.resume();
    else p.halt();
  }
}

export function usePaused(): boolean {
  return useSyncExternalStore(
    (l) => {
      controlListeners.add(l);
      return () => controlListeners.delete(l);
    },
    () => paused,
    () => false,
  );
}

const lastStatus: Partial<Record<SourceId, Status>> = {};

function watchStatusFlips() {
  const now = Date.now();
  const views: [SourceId, Status, string][] = [
    ["indexer", deriveStatus(indexer.state, now, indexerAgeSec(indexer.state, now)), "Indexer"],
    ["signal", deriveStatus(signal.state, now, signalAgeSec(signal.state, now)), "Signal API"],
  ];
  for (const [id, status, label] of views) {
    const before = lastStatus[id];
    lastStatus[id] = status;
    const pair = (s: Status | undefined) => s === "ok" || s === "stale";
    if (before && before !== status && pair(before) && pair(status)) {
      const s = pollers[id].state;
      const age = id === "indexer" ? indexerAgeSec(indexer.state, now) : signalAgeSec(signal.state, now);
      const why =
        status === "ok"
          ? ""
          : s.failure
            ? ` (the latest request failed: ${s.failure.message})`
            : age !== null
              ? ` (snapshot ${fmtDuration(age)} old)`
              : "";
      logChange(`${label}: ${before} to ${status}${why}`);
    }
  }
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  document.addEventListener("visibilitychange", () => {
    for (const p of Object.values(pollers)) {
      if (canPoll()) p.resume();
      else p.halt();
    }
  });
  subscribeClock(watchStatusFlips);
  anyListeners.add(watchStatusFlips);
  void indexer.fetchNow();
  void signal.fetchNow();
}
