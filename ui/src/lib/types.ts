// Shapes of the two live sources and the replay files.
// Authoritative: indexer/poller.ts and offchain/signal-api.py.

export const ACTIONS = ["ALLOW", "CAP", "COLLAR", "DEFER", "HALT"] as const;
export type KnownAction = (typeof ACTIONS)[number];
export type ActionName = KnownAction | `UNKNOWN(${number})`;

export const CLASSES = ["SWAP", "BORROW", "LIQUIDATE", "SETTLE"] as const;
export type ClassName = (typeof CLASSES)[number];

export type RuleOk = { action: ActionName; param: string; reason: string };
export type RuleError = { error: string };
export type Rule = RuleOk | RuleError;

export interface ChainState {
  chainId: string;
  name: string;
  healthy: boolean;
  polledAt: string;
  latencyMs: number;
  block?: string;
  /** New poller only (commit f98e60a). The deployed indexer may not send it. */
  blockTimestamp?: string;
  /** at: wall clock (old poller) or the chain's block time (new poller). */
  clock?: { open: boolean; anchor: "EQUITY_US"; at: string };
  rules?: Partial<Record<ClassName, Rule>>;
  error?: string;
}

export interface IndexerState {
  schemaVersion: number;
  ts: string;
  chains: Record<string, ChainState>;
}

export const FEEDS = ["AAPL", "TSLA", "NVDA"] as const;
export type FeedSymbol = (typeof FEEDS)[number];

export type SourceKind = "onchain" | "pilot-fallback";

export interface Signal {
  /** null = legacy single-chain shape, shown as Robinhood Chain 46630. */
  chainId: string | null;
  feed: FeedSymbol;
  anchorState: "OPEN" | "CLOSED";
  clockSource: SourceKind;
  asOf: string;
  lastLivePrint: { price: number; updatedAt: string } | null;
  stalenessSec: number | null;
  action: ActionName;
  reason: string;
  ruleParam?: number;
  ruleSource?: SourceKind;
  resumesAt: string | null;
  note?: string;
}

export interface SignalState {
  generatedAt: string | null;
  /** legacy: keyed by symbol, no chain fields. multi: keyed by "chainId/SYM". */
  shape: "legacy" | "multi";
  signals: Signal[];
}

export const isRuleOk = (r: Rule | undefined): r is RuleOk => !!r && "action" in r;

export const actionIndex = (a: ActionName): number => {
  const known = ACTIONS.indexOf(a as KnownAction);
  if (known >= 0) return known;
  const m = /^UNKNOWN\((\d+)\)$/.exec(a);
  return m ? Number(m[1]) : -1;
};

export const isKnownAction = (a: ActionName): a is KnownAction => ACTIONS.includes(a as KnownAction);

// ---------------------------------------------------------------- replays

export interface ReplayBase {
  scenario: string;
  incident?: string;
  generatedBy?: string;
  [key: string]: unknown;
}

export interface ReplayHims extends ReplayBase {
  scenario: "hims-weekend-spike";
  guarded: { action: string; fillsOutsideCollar: number; lossUsd: string };
  unguarded: { action: string; lossUsd: string };
  mondayOutage?: string;
}

export interface ReplayJelly extends ReplayBase {
  scenario: "jelly-squeeze";
  guarded: { liquidations: number; debtAfter: string };
  unguarded: { liquidations: number; debtAfter: string };
  mechanism?: string;
}

export interface ReplayStall extends ReplayBase {
  scenario: "sequencer-stall";
  liveness: { tripped: boolean; gapSec: number; maxGapSec: number };
  priceIntegrity: string;
  liquidationsDuringStall: number;
  recovery?: string;
}

export interface ReplayUsdc extends ReplayBase {
  scenario: "usdc-depeg-tip403";
  guarded: { usdcAtPar: string; merchantReceivedUsd: string; tip403?: { payee: string; refund: string } };
  unguarded: { paidUsdcAtPar: number; valueUsd: string; lossUsd: string };
}
