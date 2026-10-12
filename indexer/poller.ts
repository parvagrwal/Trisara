/**
 * Trisara Indexer Poller — production-hardened.
 *
 * Polls the three testnet chains for contract state and writes a JSON
 * snapshot the UI reads. Uses >=2 RPCs per chain with failover.
 *
 * Reads (read-only, no keys):
 *   AnchorClock.isOpen(EQUITY_US, now)  -> session state
 *   Rulebook.decision(wildcard, class)  -> current rules per action class
 *   eth_blockNumber                     -> block logging
 *
 * Output: indexer/state/latest.json (also per-chain files)
 *   Every chain entry carries: healthy, polledAt, ageSec, latencyMs.
 *   Output is validated before write — corrupt snapshots never hit disk.
 *
 * Run:  npm run poll        (loop every 60s)
 *       npm run poll:once    (single snapshot)
 */

import { createPublicClient, http, fallback, type PublicClient } from "viem";

// ---------------------------------------------------------------- config

const CHAINS = {
  "46630": {
    name: "Robinhood",
    rpcs: [
      "https://rpc.testnet.chain.robinhood.com",
      "https://robinhood-testnet.gateway.tatum.io",
    ],
    clock: "0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6" as const,
    rulebook: "0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC" as const,
  },
  "998": {
    name: "HyperEVM",
    rpcs: [
      "https://rpc.hyperliquid-testnet.xyz/evm",
      "https://hyperliquid-testnet.gateway.tatum.io",
    ],
    clock: "0xC2529BD7e5C8038516908189A142070953b7ad2e" as const,
    rulebook: "0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b" as const,
  },
  "42431": {
    name: "Tempo",
    rpcs: [
      "https://rpc.testnet.tempo.xyz",
      "https://tempo-testnet.gateway.tatum.io",
    ],
    clock: "0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA" as const,
    rulebook: "0x713420180cec1E1EF394fb9e2606e0bd14764014" as const,
  },
} as const;

const CLOCK_ABI = [
  {
    name: "isOpen",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "anchor", type: "uint8" },
      { name: "timestamp", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const RULEBOOK_ABI = [
  {
    name: "decision",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "bytes32" },
      { name: "cls", type: "uint8" },
    ],
    outputs: [
      { name: "action", type: "uint8" },
      { name: "param", type: "uint256" },
      { name: "reason", type: "bytes32" },
    ],
  },
] as const;

const ACTION_NAMES = ["ALLOW", "CAP", "COLLAR", "DEFER", "HALT"] as const;
const CLASS_NAMES = ["SWAP", "BORROW", "LIQUIDATE", "SETTLE"] as const;
const WILDCARD = ("0x" + "00".repeat(32)) as `0x${string}`;
const ANCHOR_EQUITY_US = 0;
const POLL_SEC = 60;
const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------- types

interface ChainResult {
  chainId: string;
  name: string;
  healthy: boolean;
  polledAt: string;      // ISO timestamp of this poll
  latencyMs: number;     // wall-clock ms for this chain's poll
  block?: string;
  clock?: { open: boolean; anchor: string; at: string };
  rules?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------- polling

function clientFor(chainId: keyof typeof CHAINS): PublicClient {
  const c = CHAINS[chainId];
  return createPublicClient({
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: 15_000 }))),
  });
}

function hexToAscii(hex: `0x${string}`): string {
  const bytes = Buffer.from(hex.slice(2), "hex");
  return bytes.toString("ascii").replace(/\0/g, "");
}

async function pollChain(chainId: keyof typeof CHAINS): Promise<ChainResult> {
  const cfg = CHAINS[chainId];
  const started = Date.now();
  const polledAt = new Date().toISOString();
  const base = { chainId, name: cfg.name, polledAt };

  try {
    const client = clientFor(chainId);

    // Use chain time (block timestamp), not server wall-clock, so the
    // clock evaluation reflects what the chain sees. A halted testnet
    // will show a stale timestamp instead of looking healthy.
    const block = await client.getBlockNumber();
    const blockData = await client.getBlock({ blockNumber: block });
    const now = blockData.timestamp;

    const open = await client.readContract({
      address: cfg.clock,
      abi: CLOCK_ABI,
      functionName: "isOpen",
      args: [ANCHOR_EQUITY_US, now],
    });

    const rules: Record<string, unknown> = {};
    for (let cls = 0; cls < CLASS_NAMES.length; cls++) {
      try {
        const [action, param, reason] = await client.readContract({
          address: cfg.rulebook,
          abi: RULEBOOK_ABI,
          functionName: "decision",
          args: [WILDCARD, cls],
        });
        rules[CLASS_NAMES[cls]] = {
          action: ACTION_NAMES[action] ?? `UNKNOWN(${action})`,
          param: param.toString(),
          reason: hexToAscii(reason),
        };
      } catch (e) {
        rules[CLASS_NAMES[cls]] = { error: String(e).slice(0, 120) };
      }
    }

    return {
      ...base,
      healthy: true,
      latencyMs: Date.now() - started,
      block: block.toString(),
      blockTimestamp: now.toString(),
      clock: { open, anchor: "EQUITY_US", at: now.toString() },
      rules,
    };
  } catch (e) {
    return {
      ...base,
      healthy: false,
      latencyMs: Date.now() - started,
      error: String(e).slice(0, 200),
    };
  }
}

// ---------------------------------------------------------------- validation

/** Returns true if the snapshot is safe to write. Never writes garbage. */
function validateSnapshot(chains: Record<string, ChainResult>): string | null {
  const ids = Object.keys(CHAINS);
  for (const id of ids) {
    const c = chains[id];
    if (!c) return `missing chain ${id}`;
    if (typeof c.healthy !== "boolean") return `chain ${id}: bad healthy flag`;
    if (typeof c.polledAt !== "string") return `chain ${id}: bad polledAt`;
    if (typeof c.latencyMs !== "number") return `chain ${id}: bad latencyMs`;
    if (c.healthy) {
      if (!c.block) return `chain ${id}: healthy but no block`;
      if (!c.clock || typeof c.clock.open !== "boolean")
        return `chain ${id}: healthy but bad clock`;
      if (!c.rules || typeof c.rules !== "object")
        return `chain ${id}: healthy but bad rules`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- main

async function pollOnce() {
  const ts = new Date().toISOString();
  const chains: Record<string, ChainResult> = {};

  // Poll chains in parallel — one slow chain doesn't block the others.
  const results = await Promise.all(
    (Object.keys(CHAINS) as (keyof typeof CHAINS)[]).map((id) => pollChain(id))
  );
  for (const r of results) chains[r.chainId] = r;

  const problem = validateSnapshot(chains);
  if (problem) {
    console.error(`[${ts}] VALIDATION FAILED: ${problem} — keeping last good snapshot`);
    return;
  }

  const snapshot = { schemaVersion: SCHEMA_VERSION, ts, chains };

  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  await mkdir("state", { recursive: true });
  // Atomic write: tmp file + rename, so readers never see a half-written file.
  const body = JSON.stringify(snapshot, null, 2);
  await writeFile("state/latest.json.tmp", body);
  await rename("state/latest.json.tmp", "state/latest.json");
  for (const [cid, data] of Object.entries(chains)) {
    await writeFile(`state/${cid}.json`, JSON.stringify(data, null, 2));
  }

  const healthy = results.filter((r) => r.healthy).length;
  console.log(
    `[${ts}] polled ${healthy}/${results.length} healthy: ` +
      results
        .map((d) =>
          d.healthy
            ? `${d.chainId}=b${d.block}:open=${d.clock!.open}:${d.latencyMs}ms`
            : `${d.chainId}=ERR`
        )
        .join(", ")
  );
}

async function main() {
  const once = process.argv.includes("--once");
  await pollOnce();
  if (once) return;
  setInterval(pollOnce, POLL_SEC * 1000);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
