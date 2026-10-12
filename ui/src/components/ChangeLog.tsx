"use client";

import { useChanges } from "@/lib/live";
import { fmtLocalTime } from "@/lib/format";

/** What this page has seen change since it opened. In memory only, newest first, never pre-populated. */
export function ChangeLog() {
  const changes = useChanges();
  return (
    <section aria-labelledby="changes-title" className="mt-4">
      <h3 id="changes-title" className="font-mono text-[13px] font-semibold [font-stretch:87.5%]">
        Changes seen
      </h3>
      {changes.length === 0 ? (
        <p className="mt-1 text-[14px] text-ink-2">
          Nothing has changed since you opened this page. A line appears here when a session opens or closes or a rule
          changes.
        </p>
      ) : (
        <ol className="data mt-2 max-h-56 divide-y divide-rule overflow-y-auto border-y border-rule">
          {changes.map((c) => (
            <li key={c.id} className="flex gap-4 px-1 py-1.5">
              <time className="shrink-0 text-ink-2" dateTime={new Date(c.at).toISOString()}>
                {fmtLocalTime(c.at)}
              </time>
              <span>{c.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
