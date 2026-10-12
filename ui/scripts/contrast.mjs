#!/usr/bin/env node
// WCAG contrast check for the design tokens in src/app/globals.css.
// Text pairs must reach 4.5:1; graphics (dots, glyph strokes, focus rings,
// gauge fills) 3:1. Composite backgrounds model the change flash (phosphor at
// 18% over the background).
//
// Stale and late data are "dimmed" by stepping every text colour down one
// level (ink -> ink-2 -> ink-3, platen-text -> platen-dim; see .is-dim in
// globals.css), never with opacity: 70% opacity would drop tertiary and action
// text below 4.5:1. The stepped-down pairs are the base pairs checked below.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = process.env.CONTRAST_CSS ?? join(here, "..", "src", "app", "globals.css");

export function readTokens(css = readFileSync(cssPath, "utf8")) {
  const tokens = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2];
  return tokens;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Paint `fg` at `alpha` over `bg`. */
const over = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// [foreground, background, kind]. Backgrounds may be "flash:<bg>": phosphor
// at 18% over <bg>.
const PAPER_BGS = ["fanfold", "bar"];
const TERM_BGS = ["platen", "platen-band"];
const PAPER_TEXT = ["ink", "ink-2", "ink-3", "ribbon", "allow", "cap", "collar", "defer", "halt"];
const TERM_TEXT = ["platen-text", "platen-dim", "allow-t", "cap-t", "collar-t", "defer-t", "halt-t", "ribbon-t"];

export function pairs() {
  const list = [];
  for (const bg of PAPER_BGS) for (const fg of PAPER_TEXT) list.push([fg, bg, "text"]);
  for (const bg of TERM_BGS) for (const fg of TERM_TEXT) list.push([fg, bg, "text"]);
  // Buttons: paper text on ink fill and on ribbon fill.
  list.push(["fanfold", "ink", "text"], ["fanfold", "ribbon", "text"]);
  // Change flash, on paper rows and bands and on the terminal.
  for (const fg of PAPER_TEXT) list.push([fg, "flash:fanfold", "text"], [fg, "flash:bar", "text"]);
  for (const fg of TERM_TEXT) list.push([fg, "flash:platen", "text"], [fg, "flash:platen-band", "text"]);
  // Graphics: focus rings, live pulse, dots, glyphs, gauge fills.
  for (const bg of PAPER_BGS) for (const fg of ["ribbon", "ink-3", "allow", "cap", "collar", "defer", "halt"]) list.push([fg, bg, "graphic"]);
  for (const bg of TERM_BGS) for (const fg of ["ribbon-t", "phosphor", "platen-dim", "allow-t", "cap-t", "collar-t", "defer-t", "halt-t"]) list.push([fg, bg, "graphic"]);
  return list;
}

export function runContrast({ quiet = false } = {}) {
  const t = readTokens();
  const color = (name) => {
    if (!t[name]) throw new Error(`token --color-${name} not found in globals.css`);
    return hexToRgb(t[name]);
  };
  const bgOf = (spec) => (spec.startsWith("flash:") ? over(color("phosphor"), color(spec.slice(6)), 0.18) : color(spec));
  const failures = [];
  const rows = [];
  for (const [fgSpec, bgSpec, kind] of pairs()) {
    const bg = bgOf(bgSpec);
    const fg = color(fgSpec);
    const r = ratio(fg, bg);
    const min = kind === "text" ? 4.5 : 3;
    const ok = r >= min;
    rows.push(`${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  ${kind.padEnd(7)} ${fgSpec} on ${bgSpec}`);
    if (!ok) failures.push(`${fgSpec} on ${bgSpec}: ${r.toFixed(2)} < ${min}`);
  }
  if (!quiet) console.log(rows.join("\n"));
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const failures = runContrast({ quiet: process.argv.includes("--quiet") });
  if (failures.length) {
    console.error(`\n[contrast] ${failures.length} pair(s) below threshold:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\n[contrast] all pairs pass");
}
