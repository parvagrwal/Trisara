"use client";

import { useAnnouncement } from "@/lib/live";

/** The page's one polite live region. Updated only when a session state or an action changes. */
export function LiveAnnouncer() {
  const { text } = useAnnouncement();
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
