"use client";

import { ActionGlyph } from "./Glyphs";
import { Tip } from "./Tip";
import { actionIndex, isKnownAction, type ActionName } from "@/lib/types";

const PAPER: Record<string, string> = {
  ALLOW: "text-allow",
  CAP: "text-cap",
  COLLAR: "text-collar",
  DEFER: "text-defer",
  HALT: "text-halt",
};
const PLATEN: Record<string, string> = {
  ALLOW: "text-allow-t",
  CAP: "text-cap-t",
  COLLAR: "text-collar-t",
  DEFER: "text-defer-t",
  HALT: "text-halt-t",
};

export const actionColor = (action: ActionName, surface: "paper" | "platen") =>
  (surface === "paper" ? PAPER : PLATEN)[action] ?? (surface === "paper" ? "text-defer" : "text-defer-t");

/** Glyph plus action name; unknown actions get an amber outline and a tooltip. */
export function ActionChip({
  action,
  surface,
  className = "",
}: {
  action: ActionName;
  surface: "paper" | "platen";
  className?: string;
}) {
  const color = actionColor(action, surface);
  if (!isKnownAction(action)) {
    return (
      <Tip content={`This page doesn't know action ${actionIndex(action)}.`}>
        <span
          className={`inline-flex items-center gap-1.5 rounded-sm px-1 outline outline-1 ${surface === "paper" ? "outline-defer" : "outline-defer-t"} ${color} ${className}`}
        >
          <ActionGlyph action={action} />
          <span className="font-semibold">{action}</span>
        </span>
      </Tip>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${color} ${className}`}>
      <ActionGlyph action={action} />
      <span className="font-semibold">{action}</span>
    </span>
  );
}
