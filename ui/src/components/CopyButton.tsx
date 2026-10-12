"use client";

import { useEffect, useState } from "react";
import { CheckGlyph, CopyGlyph } from "./Glyphs";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard access (insecure origins).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** "Copy", then "Copied" for 2 s. */
export function CopyButton({
  text,
  label = "Copy",
  surface = "paper",
  describe,
  className = "",
}: {
  text: string;
  label?: string;
  surface?: "paper" | "platen";
  /** Accessible context, e.g. "the isOpen command". */
  describe?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const tone =
    surface === "platen"
      ? "border-platen-rule text-platen-text hover:border-platen-dim"
      : "border-rule bg-fanfold text-ink hover:border-ink-3";
  return (
    <button
      type="button"
      onClick={async () => setState((await writeClipboard(text)) ? "copied" : "failed")}
      className={`tap inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 font-mono text-[12px] [font-stretch:87.5%] ${tone} ${className}`}
      aria-label={describe ? `${state === "copied" ? "Copied" : label} ${describe}` : undefined}
    >
      {state === "copied" ? <CheckGlyph size={11} /> : <CopyGlyph size={11} />}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}</span>
    </button>
  );
}
