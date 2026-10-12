"use client";

import { useEffect, useRef, useState } from "react";
import { Mark } from "./Mark";
import { REPO_URL } from "@/lib/config";
import { column, primaryButton, secondaryButton } from "@/lib/styles";

const LINKS = [
  { href: "#terminal", label: "Terminal" },
  { href: "#how", label: "How it works" },
  { href: "#try", label: "Try it" },
  { href: "#faq", label: "Questions" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-fanfold">
      <nav aria-label="Main" className={`${column} flex h-14 items-center gap-6`}>
        <a href="#top" className="flex items-center gap-2 font-mono text-[17px] font-semibold text-ink no-underline [font-stretch:87.5%]">
          <Mark />
          Trisara
        </a>
        <ul className="hidden items-center gap-5 min-[720px]:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="font-mono text-[13px] text-ink-2 no-underline [font-stretch:87.5%] hover:text-ink hover:underline">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-2 min-[960px]:flex">
          <a href="#try" className={`${primaryButton} h-9`}>
            Try it now
          </a>
          <a href={REPO_URL} className={`${secondaryButton} h-9`}>
            Read the contracts
          </a>
        </div>
        <button
          ref={menuButton}
          type="button"
          className="tap ml-auto inline-flex h-9 items-center rounded-[6px] border border-ink px-3 font-mono text-[13px] min-[720px]:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </nav>
      {open ? (
        <div id="mobile-menu" className="border-t border-rule bg-fanfold px-6 pb-5 pt-2 min-[720px]:hidden">
          <ul className="divide-y divide-rule">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center font-mono text-[14px] text-ink no-underline"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="#try" onClick={() => setOpen(false)} className={primaryButton}>
              Try it now
            </a>
            <a href={REPO_URL} className={secondaryButton}>
              Read the contracts
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
