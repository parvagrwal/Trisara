#!/usr/bin/env node
// Post-build checks (npm run check runs typecheck, lint and build first).
//  1. out/index.html and the four replay files exist.
//  2. out/state-latest.json does not exist.
//  3. No Math.random anywhere in src/.
//  4. The static HTML of the hero and the terminal carries no market data:
//     skeletons only, no OPEN/CLOSED, no prices, no block numbers.
//  5. Every colour pair passes WCAG (scripts/contrast.mjs).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runContrast } from "./contrast.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const failures = [];
const passes = [];
const check = (ok, pass, fail) => (ok ? passes.push(pass) : failures.push(fail));

// 1. build output
const indexPath = join(out, "index.html");
check(existsSync(indexPath), "out/index.html exists", "out/index.html is missing (run npm run build)");
const REPLAYS = ["hims-aug29-31-2026.json", "jelly-mar2025.json", "rh-stall-sep4-2026.json", "usdc-mar2023.json"];
for (const f of REPLAYS) {
  const p = join(out, "replays", f);
  let ok = false;
  try {
    ok = typeof JSON.parse(readFileSync(p, "utf8")).scenario === "string";
  } catch {
    ok = false;
  }
  check(ok, `out/replays/${f} exists and has a scenario`, `out/replays/${f} is missing or has no scenario key`);
}

// 2. stale snapshot must not ship
check(!existsSync(join(out, "state-latest.json")), "out/state-latest.json is absent", "out/state-latest.json exists (postbuild must delete it)");

// 3. no Math.random in src/
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const offenders = walk(join(root, "src")).filter((p) => /\.(tsx?|jsx?|mjs)$/.test(p) && /Math\s*\.\s*random/.test(readFileSync(p, "utf8")));
check(offenders.length === 0, "no Math.random in src/", `Math.random found in: ${offenders.map((p) => relative(root, p)).join(", ")}`);

// 4. static HTML carries no market numbers
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** Outer HTML of the element whose start tag contains `marker`, by tag balancing. */
function element(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [full, name, selfClose] = m;
    if (VOID.has(name.toLowerCase()) || selfClose) continue;
    depth += full.startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + full.length);
  }
  return null;
}
const text = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");

if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8");
  const regions = [
    ["hero", 'aria-labelledby="hero-title"'],
    ["session slip", 'data-check="slip"'],
    ["terminal", 'data-check="terminal"'],
  ];
  for (const [name, marker] of regions) {
    const el = element(html, marker);
    if (!el) {
      failures.push(`static HTML: ${name} region (${marker}) not found`);
      continue;
    }
    const t = text(el);
    const bad = [];
    if (/\b(OPEN|CLOSED)\b/.test(t)) bad.push("OPEN/CLOSED");
    if (/\$\s?\d/.test(t)) bad.push("a price");
    if (/\b\d+\.\d{2,}\b/.test(t)) bad.push("a decimal number");
    if (/\b\d{1,3}(,\d{3})+\b/.test(t)) bad.push("a block number");
    if (/\b\d+\s?ms\b/.test(t)) bad.push("a latency");
    if (/\b\d+s ago\b|\b\d+h \d+m\b|\b\d+m \d+s\b/.test(t)) bad.push("an age");
    check(bad.length === 0, `static ${name} has no market data`, `static ${name} contains ${bad.join(", ")}: ${t.slice(0, 200)}`);
    if (name !== "hero") check(el.includes("data-skeleton"), `static ${name} renders skeletons`, `static ${name} has no skeleton rows`);
  }
  check(!html.includes("state-latest"), "index.html never references state-latest.json", "index.html references state-latest.json");
  check(!/fonts\.(googleapis|gstatic)\.com/.test(html), "no third-party font requests", "index.html requests third-party fonts");
  check(html.includes("<noscript>"), "noscript fallback present", "no <noscript> fallback in index.html");
}

// 5. contrast
const contrast = runContrast({ quiet: true });
check(contrast.length === 0, "all colour pairs pass WCAG thresholds", `contrast: ${contrast.join("; ")}`);

for (const p of passes) console.log(`ok   ${p}`);
for (const f of failures) console.error(`FAIL ${f}`);
if (failures.length) {
  console.error(`\n[check] ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\n[check] all ${passes.length} checks passed`);
