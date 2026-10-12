"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Flashes its background (phosphor, 18%, 600 ms) when `value` changes between
 * renders. Never flashes on the first value or on unchanged values. Under
 * reduced motion the CSS swaps the animation for a static outline.
 */
export function Flash({
  value,
  children,
  className = "",
  as: Tag = "span",
}: {
  value: string | number | boolean | null | undefined;
  children: ReactNode;
  className?: string;
  as?: "span" | "div" | "td";
}) {
  const prev = useRef(value);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (prev.current === value) return;
    const hadValue = prev.current !== undefined && prev.current !== null;
    prev.current = value;
    if (!hadValue) return;
    // The class is off between flashes (polls are 30 s apart), so re-adding it restarts the animation.
    const start = setTimeout(() => setOn(true), 0);
    const stop = setTimeout(() => setOn(false), 640);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [value]);

  return <Tag className={`${on ? "flash" : ""} ${className}`}>{children}</Tag>;
}
