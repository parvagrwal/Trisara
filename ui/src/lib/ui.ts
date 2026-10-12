// UI-only client state and browser hooks (no data fetching here).

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useNow } from "./live";

// ---------------------------------------------------------------- active chain
// Shared by the terminal's plain-English chips and the access-point command.

let activeChain = "46630";
const chainListeners = new Set<() => void>();

export function setActiveChain(id: string) {
  if (id === activeChain) return;
  activeChain = id;
  chainListeners.forEach((l) => l());
}

export function useActiveChain(): string {
  return useSyncExternalStore(
    (l) => {
      chainListeners.add(l);
      return () => chainListeners.delete(l);
    },
    () => activeChain,
    () => "46630",
  );
}

// ---------------------------------------------------------------- reduced motion

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(MOTION_QUERY);
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

// ---------------------------------------------------------------- media query

export function useMedia(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

// ---------------------------------------------------------------- in view (once)

export function useSeenOnce(ref: RefObject<Element | null>, threshold = 0.25): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setSeen(true));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

// ---------------------------------------------------------------- boot print
// Rows print in once, on the first data arrival of the page view. The class is
// dropped a few seconds later so re-mounted rows (tab switches) don't replay it.

const BOOT_WINDOW_MS = 3_000;

export function useBootPrint(firstDataAt: number | null): boolean {
  const now = useNow();
  return firstDataAt !== null && now - firstDataAt < BOOT_WINDOW_MS;
}
