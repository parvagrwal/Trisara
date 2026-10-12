"use client";

export type DotTone = "ok" | "late" | "down" | "none";

const PAPER: Record<DotTone, string> = {
  ok: "bg-allow",
  late: "bg-defer",
  down: "bg-halt",
  none: "bg-ink-3",
};
const PLATEN: Record<DotTone, string> = {
  ok: "bg-allow-t",
  late: "bg-defer-t",
  down: "bg-halt-t",
  none: "bg-platen-dim",
};

/** Pulses (opacity only) when ok; still when late; never pulses when down. Decorative: pair with text. */
export function StatusDot({
  tone,
  surface = "paper",
  pulse = tone === "ok",
  className = "",
}: {
  tone: DotTone;
  surface?: "paper" | "platen";
  pulse?: boolean;
  className?: string;
}) {
  const color = (surface === "paper" ? PAPER : PLATEN)[tone];
  const shape = tone === "down" ? "rounded-[1px] rotate-45" : tone === "none" ? "rounded-full opacity-90" : "rounded-full";
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 ${shape} ${color} ${pulse && tone === "ok" ? "dot-pulse" : ""} ${className}`}
    />
  );
}
