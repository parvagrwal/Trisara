#!/usr/bin/env node
// Reads ../deployments/{46630,998,42431,46630-full}.json and writes
// src/data/deployments.generated.json. The generated file is committed so a
// build never depends on the parent directory.
//
// Fails when the AnchorClock or Rulebook the indexer and Signal API poll no
// longer match the files. Warns (does not fail) when DEPLOYED.md lags the files.
//
//   node scripts/sync-deployments.mjs              # fail if ../deployments is missing
//   node scripts/sync-deployments.mjs --if-present # skip quietly if it is missing

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, "..");
const repoRoot = resolve(uiRoot, "..");
const depDir = join(repoRoot, "deployments");
const outFile = join(uiRoot, "src", "data", "deployments.generated.json");
const ifPresent = process.argv.includes("--if-present");

if (!existsSync(depDir)) {
  if (ifPresent) {
    console.log("[sync-deployments] ../deployments not found; using the committed deployments.generated.json");
    process.exit(0);
  }
  console.error(`[sync-deployments] ${depDir} not found`);
  process.exit(1);
}

const FILES = ["46630", "998", "42431", "46630-full"];
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// What the indexer (indexer/poller.ts) and the Signal API (offchain/signal-api.py) poll.
const POLLED = {
  "46630": { AnchorClock: "0x7998C5B332B843da2BcCc2088eA7487C92C7f1c6", Rulebook: "0x2f8c1823bD51A71873b00eB4bc66BA6Cf76634cC" },
  "998": { AnchorClock: "0xC2529BD7e5C8038516908189A142070953b7ad2e", Rulebook: "0x9E66204Fd16238102D0D9c5160D3E02Ea3f5558b" },
  "42431": { AnchorClock: "0x7F5C6E3eAACD95b3acDEC32Ab47d89887ceE74dA", Rulebook: "0x713420180cec1E1EF394fb9e2606e0bd14764014" },
};

const failures = [];
const warnings = [];
const out = {};

for (const name of FILES) {
  const path = join(depDir, `${name}.json`);
  if (!existsSync(path)) {
    failures.push(`missing ${path}`);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    failures.push(`${name}.json is not valid JSON: ${e.message}`);
    continue;
  }
  const entries = {};
  for (const [contract, address] of Object.entries(parsed)) {
    if (typeof address !== "string" || !ADDRESS.test(address)) {
      failures.push(`${name}.json: ${contract} is not an address (${JSON.stringify(address)})`);
      continue;
    }
    entries[contract] = address;
  }
  out[name] = entries;
}

for (const [chainId, expected] of Object.entries(POLLED)) {
  for (const [contract, address] of Object.entries(expected)) {
    const actual = out[chainId]?.[contract];
    if (!actual) failures.push(`${chainId}.json has no ${contract}`);
    else if (actual.toLowerCase() !== address.toLowerCase()) {
      failures.push(`${chainId}.json ${contract} is ${actual}; the indexer and Signal API poll ${address}`);
    }
  }
}

// DEPLOYED.md drift check for the 46630 consumers. The JSON files win.
const deployedMd = join(repoRoot, "DEPLOYED.md");
const CONSUMERS = ["GuardedFeed", "GuardedSwapRouter", "GuardedLender", "GuardedSettlementRouter"];
if (existsSync(deployedMd)) {
  const md = readFileSync(deployedMd, "utf8");
  const section = md.split(/\*\*Robinhood Chain testnet \(46630\):\*\*/)[1]?.split(/\n\*\*/)[0] ?? "";
  const listed = {};
  for (const m of section.matchAll(/^- (\w+) `(0x[0-9a-fA-F]{40})`/gm)) listed[m[1]] = m[2];
  for (const name of CONSUMERS) {
    const doc = listed[name];
    const file = out["46630-full"]?.[name];
    if (!doc) warnings.push(`DEPLOYED.md does not list ${name} for 46630`);
    else if (file && doc.toLowerCase() !== file.toLowerCase()) {
      warnings.push(`DEPLOYED.md lists ${name} ${doc}; 46630-full.json has ${file} (the JSON file wins)`);
    }
  }
} else {
  warnings.push("DEPLOYED.md not found; skipped the drift check");
}

// Source files the page links to must exist (keep in sync with src/data/sources.ts).
const SOURCES = [
  "src/AnchorClock.sol",
  "src/Rulebook.sol",
  "src/PriceIntegrity.sol",
  "src/GuardedFeed.sol",
  "src/adapters/LivenessAdapter.sol",
  "src/adapters/ReferenceFeedAdapter.sol",
  "src/consumers/GuardedSwapRouter.sol",
  "src/consumers/GuardedLender.sol",
  "src/consumers/GuardedSettlementRouter.sol",
  "src/testnet/MockAggregator.sol",
  "src/testnet/MockStable.sol",
  "src/testnet/AllowAllPolicy.sol",
];
for (const rel of SOURCES) {
  if (!existsSync(join(repoRoot, rel))) warnings.push(`linked source file not found: ${rel}`);
}

for (const w of warnings) console.warn(`[sync-deployments] warning: ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`[sync-deployments] FAIL: ${f}`);
  process.exit(1);
}

const body = JSON.stringify(out, null, 2) + "\n";
const previous = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
if (previous !== body) {
  writeFileSync(outFile, body);
  console.log(`[sync-deployments] wrote ${outFile}`);
} else {
  console.log("[sync-deployments] deployments.generated.json is up to date");
}
