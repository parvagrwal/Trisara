"use client";

import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

/** A code block with a copy button. Lines starting with "#" are comments. */
export function CommandBlock({
  code,
  label,
  surface = "paper",
  footer,
  lang = "shell",
  stack = false,
}: {
  code: string;
  /** Accessible name for the copy button target. */
  label: string;
  surface?: "paper" | "platen";
  footer?: ReactNode;
  lang?: "shell" | "solidity";
  /** Copy button above the code at every width (narrow columns), so the code gets the full width. */
  stack?: boolean;
}) {
  const box =
    surface === "platen"
      ? "bg-platen text-platen-text border-platen-rule"
      : "bg-[color-mix(in_srgb,var(--color-bar)_55%,var(--color-fanfold))] text-ink border-rule";
  return (
    <div className={`border ${box}`}>
      <div className={`flex flex-col-reverse gap-2 px-3 py-2.5 ${stack ? "" : "sm:flex-row sm:items-start sm:gap-3"}`}>
        <pre
          className={`data min-w-0 flex-1 py-0.5 leading-[1.7] overflow-x-auto whitespace-pre`}
          tabIndex={0}
          aria-label={`${label} (${lang})`}
        >
          <code>{code}</code>
        </pre>
        <CopyButton text={code} surface={surface} describe={label} className={`self-end ${stack ? "" : "sm:self-auto"}`} />
      </div>
      {footer ? (
        <div className={`border-t px-3 py-2 text-[14px] ${surface === "platen" ? "border-platen-rule text-platen-dim" : "border-rule text-ink-2"}`}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
