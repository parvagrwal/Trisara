// Runtime endpoints. NEXT_PUBLIC_* values are inlined at build time.
const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const INDEXER_URL = trimSlash(process.env.NEXT_PUBLIC_INDEXER_URL ?? "https://trisara-indexer.onrender.com");
export const SIGNAL_URL = trimSlash(process.env.NEXT_PUBLIC_SIGNAL_URL ?? "https://trisara-signal-api.onrender.com");
export const REPO_URL = trimSlash(process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/parvagrwal/Trisara"); // default branch: main
export const WAITLIST_ENDPOINT = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT || null;
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || null;

export const INDEXER_STATE_URL = `${INDEXER_URL}/state`;
export const SIGNAL_STATE_URL = `${SIGNAL_URL}/signal`;

export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const COLOSSEUM_URL = "https://colosseum.com";

// Polling and status thresholds (brief section 3.3).
export const POLL_MS = 30_000;
export const FIRST_TIMEOUT_MS = 45_000;
export const NEXT_TIMEOUT_MS = 15_000;
export const WARMING_RETRY_MS = 5_000;
export const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;
export const WAKING_AFTER_MS = 4_000;
export const LATE_AFTER_SEC = 150;
export const STALLED_AFTER_SEC = 600;
export const CLOCK_SKEW_HINT_SEC = 30;
export const STALE_FEED_SEC = 900; // Signal API STALE_THRESHOLD_SEC
export const CHAIN_LAG_WARN_SEC = 120;
export const CHAIN_LAG_BAD_SEC = 600;
export const LATENCY_GAUGE_MAX_MS = 3_000;
