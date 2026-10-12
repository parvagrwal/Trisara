"use client";

/**
 * A small horizontal gauge. `value` and `max` share a unit; `mark` draws a
 * threshold tick. Decorative: the number is always printed beside it.
 */
export function Gauge({
  value,
  max,
  mark,
  tone = "neutral",
  surface = "platen",
  width = 64,
  label,
}: {
  value: number | null;
  max: number;
  mark?: number;
  tone?: "neutral" | "ok" | "warn" | "bad";
  surface?: "paper" | "platen";
  width?: number;
  label?: string;
}) {
  const frac = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(1, value / max));
  const fill =
    surface === "platen"
      ? { neutral: "bg-platen-dim", ok: "bg-allow-t", warn: "bg-defer-t", bad: "bg-halt-t" }[tone]
      : { neutral: "bg-ink-3", ok: "bg-allow", warn: "bg-defer", bad: "bg-halt" }[tone];
  const track = surface === "platen" ? "bg-platen-rule" : "bg-rule";
  return (
    <span
      className={`relative inline-block h-1.5 shrink-0 align-middle ${track}`}
      style={{ width }}
      title={label}
      aria-hidden="true"
    >
      <span className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${frac * 100}%` }} />
      {mark !== undefined && (
        <span
          className={`absolute -top-1 -bottom-1 w-px ${surface === "platen" ? "bg-platen-text" : "bg-ink"}`}
          style={{ left: `${Math.min(1, mark / max) * 100}%` }}
        />
      )}
    </span>
  );
}
