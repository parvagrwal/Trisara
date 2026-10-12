"use client";

import { useEffect, useState } from "react";

const PITCH = 24;

/**
 * Fanfold sprocket holes down the left edge (1024px and up). Holes above the
 * current scroll position fill in: a scroll-progress ruler. Decorative.
 */
export function SprocketRail() {
  const [view, setView] = useState<{ holes: number; filled: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      const max = document.documentElement.scrollHeight - vh;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      const holes = Math.ceil(vh / PITCH);
      setView({ holes, filled: Math.round(progress * holes) });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div aria-hidden="true" className="sprocket hidden lg:block">
      {view ? (
        <svg width="24" height={view.holes * PITCH} className="block">
          {Array.from({ length: view.holes }, (_, i) => (
            <circle
              key={i}
              cx="12"
              cy={i * PITCH + PITCH / 2}
              r="4"
              fill={i < view.filled ? "var(--color-ink-3)" : "var(--color-fanfold)"}
              stroke="var(--color-ink-3)"
              strokeWidth="1"
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
