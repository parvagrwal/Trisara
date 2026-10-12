#!/usr/bin/env node
// Runs after `next build`. Next copies public/ into out/, which would publish
// the stale committed snapshot public/state-latest.json (old shape, 2026-10-10).
// The page never reads it, so it must not ship. The source file is left alone.

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const stale = join(out, "state-latest.json");

if (!existsSync(join(out, "index.html"))) {
  console.error("[postbuild] out/index.html is missing: did next build run with output: \"export\"?");
  process.exit(1);
}
if (existsSync(stale)) {
  rmSync(stale);
  console.log("[postbuild] deleted out/state-latest.json (stale committed snapshot; the page never reads it)");
} else {
  console.log("[postbuild] out/state-latest.json not present");
}
