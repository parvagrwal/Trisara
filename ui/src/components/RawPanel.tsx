"use client";

import { CopyButton } from "./CopyButton";
import { useIndexer, useSignal, type SourceState } from "@/lib/live";
import { fmtUtc } from "@/lib/format";

function RawBlock({ source, name }: { source: SourceState<unknown>; name: string }) {
  const raw = source.raw;
  return (
    <details open className="border border-platen-rule">
      <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 font-mono text-[12px] [font-stretch:87.5%]">
        <span className="font-semibold text-platen-text">{name}</span>
        <span className="text-platen-dim">GET {source.url}</span>
        {raw ? (
          <span className="text-platen-dim">
            HTTP {raw.status}, fetched {fmtUtc(raw.at)}
          </span>
        ) : (
          <span className="text-platen-dim">no response body yet{source.failure ? ` (${source.failure.message})` : ""}</span>
        )}
      </summary>
      {raw ? (
        <div className="flex items-start gap-2 border-t border-platen-rule p-3">
          <pre tabIndex={0} aria-label={`Raw ${name} response`} className="data max-h-[420px] min-w-0 flex-1 overflow-auto whitespace-pre text-platen-text">
            {raw.body}
          </pre>
          <CopyButton text={raw.body} surface="platen" describe={`the raw ${name} response`} />
        </div>
      ) : null}
    </details>
  );
}

/** The exact response bodies, as received. The proof that nothing is mocked. */
export function RawPanel() {
  const indexer = useIndexer();
  const signal = useSignal();
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-platen-dim">
        The exact bodies of the latest responses, byte for byte, with their fetch times.
      </p>
      <RawBlock source={indexer} name="indexer" />
      <RawBlock source={signal} name="Signal API" />
    </div>
  );
}
