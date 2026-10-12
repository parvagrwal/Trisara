"use client";

import { Flash } from "./Flash";
import { LockGlyph, OpenGlyph, DownGlyph } from "./Glyphs";
import { Skel } from "./Skeleton";
import { Tip } from "./Tip";
import { FreshnessChip, SourceGate, isDim } from "./ErrorPanel";
import { CHAINS } from "@/data/chains";
import { deriveStatus, indexerAgeSec, signalAgeSec, useIndexer, useNow, useSignal } from "@/lib/live";
import { fmtBlock, fmtDuration } from "@/lib/format";
import { signalsFor } from "@/lib/normalize";
import { useBootPrint } from "@/lib/ui";
import type { IndexerState } from "@/lib/types";

const COLS = ["5ch", "13ch", "7ch", "11ch", "7ch"];
const RESUMES_TIP = "The API assumes the next weekday and does not model holidays. The onchain clock does.";

function Rows({ data, now, boot }: { data: IndexerState; now: number; boot: boolean }) {
  return (
    <>
      {CHAINS.map((c, i) => {
        const chain = data.chains[c.id];
        const cls = `${i % 2 === 1 ? "bg-bar" : ""} ${boot ? "print-row" : ""}`;
        const style = boot ? { animationDelay: `${i * 60}ms` } : undefined;
        if (!chain) {
          return (
            <tr key={c.id} className={cls} style={style}>
              <td className="px-2.5 py-2">{c.id}</td>
              <td className="px-2.5 py-2">{c.name}</td>
              <td className="px-2.5 py-2 text-ink-2" colSpan={3}>
                not in this snapshot
              </td>
            </tr>
          );
        }
        if (!chain.healthy) {
          return (
            <tr key={c.id} className={cls} style={style}>
              <td className="px-2.5 py-2">{c.id}</td>
              <td className="px-2.5 py-2">{c.name}</td>
              <td className="px-2.5 py-2 text-halt" colSpan={3}>
                <span className="inline-flex max-w-full items-center gap-1.5">
                  <DownGlyph size={10} />
                  <span className="font-semibold">down</span>
                  <Tip content={chain.error ?? "no error text"}>
                    <span className="block max-w-[22ch] truncate text-ink-2">{chain.error ?? ""}</span>
                  </Tip>
                </span>
              </td>
            </tr>
          );
        }
        const polledAge = now ? (now - Date.parse(chain.polledAt)) / 1000 : null;
        const open = chain.clock?.open;
        return (
          <tr key={c.id} className={cls} style={style}>
            <td className="px-2.5 py-2 text-ink-2">{c.id}</td>
            <td className="px-2.5 py-2">{c.name}</td>
            <td className="px-2.5 py-2">
              <Flash value={open === undefined ? undefined : String(open)}>
                {open === undefined ? (
                  "—"
                ) : (
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${open ? "text-allow" : "text-ink"}`}>
                    {open ? <OpenGlyph size={10} /> : <LockGlyph size={10} />}
                    {open ? "OPEN" : "CLOSED"}
                  </span>
                )}
              </Flash>
            </td>
            <td className="px-2.5 py-2 text-right">
              <Flash value={chain.block}>{fmtBlock(chain.block)}</Flash>
            </td>
            <td className="px-2.5 py-2 text-right text-ink-2">{polledAge === null ? "—" : `${fmtDuration(polledAge)} ago`}</td>
          </tr>
        );
      })}
    </>
  );
}

/** Under 640px: two lines per chain instead of five columns. */
function MobileRows({ data, now, boot }: { data: IndexerState; now: number; boot: boolean }) {
  return (
    <ul className="data sm:hidden" aria-label="Session state per chain from the indexer">
      {CHAINS.map((c, i) => {
        const chain = data.chains[c.id];
        const open = chain?.healthy ? chain.clock?.open : undefined;
        const polledAge = chain && now ? (now - Date.parse(chain.polledAt)) / 1000 : null;
        return (
          <li
            key={c.id}
            className={`px-2.5 py-2 ${i % 2 === 1 ? "bg-bar" : ""} ${boot ? "print-row" : ""}`}
            style={boot ? { animationDelay: `${i * 60}ms` } : undefined}
          >
            <div className="flex justify-between gap-3">
              <span>
                <span className="text-ink-2">{c.id}</span> {c.name}
              </span>
              {!chain ? (
                <span className="text-ink-2">not in snapshot</span>
              ) : !chain.healthy ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-halt">
                  <DownGlyph size={10} /> down
                </span>
              ) : (
                <Flash value={open === undefined ? undefined : String(open)}>
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${open ? "text-allow" : "text-ink"}`}>
                    {open === undefined ? null : open ? <OpenGlyph size={10} /> : <LockGlyph size={10} />}
                    {open === undefined ? "—" : open ? "OPEN" : "CLOSED"}
                  </span>
                </Flash>
              )}
            </div>
            {chain ? (
              <div className="flex justify-between gap-3 text-ink-2">
                {chain.healthy ? (
                  <span>
                    block <Flash value={chain.block}>{fmtBlock(chain.block)}</Flash>
                  </span>
                ) : (
                  <Tip content={chain.error ?? "no error text"}>
                    <span className="block max-w-[24ch] truncate">{chain.error ?? ""}</span>
                  </Tip>
                )}
                <span>{polledAge === null ? "—" : `polled ${fmtDuration(polledAge)} ago`}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NextOpen() {
  const signal = useSignal();
  const indexer = useIndexer();
  const now = useNow();
  const status = deriveStatus(signal, now, signalAgeSec(signal, now));
  if (!signal.data) {
    if (status === "error") return <>Next open unavailable: the Signal API isn&apos;t responding.</>;
    return (
      <>
        US equities, estimated next open in <Skel w="7ch" />
      </>
    );
  }
  const sigs = signalsFor(signal.data, "46630");
  const s = sigs.find((x) => x.resumesAt) ?? sigs[0];
  if (!s) return <>Next open unavailable: the Signal API returned no signals.</>;
  if (s.anchorState === "OPEN") return <>US equities are open, per the onchain clock the Signal API reads.</>;
  if (!s.resumesAt) return <>Next open unavailable: the Signal API sent no resumes_at.</>;
  const left = (Date.parse(s.resumesAt) - now) / 1000;
  const indexerOpen = indexer.data?.chains["46630"]?.clock?.open;
  if (now && left <= 0) {
    return indexerOpen ? (
      <>US equities are open, per the indexer&apos;s onchain clock reading.</>
    ) : (
      <>US equities: past the estimated open; waiting for the onchain clock.</>
    );
  }
  return (
    <>
      US equities,{" "}
      <Tip content={RESUMES_TIP}>
        <span className="underline decoration-dotted underline-offset-4">estimated next open</span>
      </Tip>{" "}
      in <span className="data font-semibold text-ink">{now ? fmtDuration(left) : "—"}</span>
    </>
  );
}

/** Hero session slip: one ruled row per chain, fed by the indexer. */
export function SessionSlip() {
  const indexer = useIndexer();
  const now = useNow();
  const age = indexerAgeSec(indexer, now);
  const status = deriveStatus(indexer, now, age);
  const boot = useBootPrint(indexer.firstDataAt);
  return (
    <figure data-check="slip" className="border-y-2 border-ink">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-1.5 font-mono text-[12px] text-ink-2 [font-stretch:87.5%]">
        <span>session slip, printed from live data</span>
        <FreshnessChip source={indexer} ageSec={age} surface="paper" />
      </figcaption>
      <SourceGate
        source={indexer}
        status={status}
        surface="paper"
        skeleton={
          <table className="data w-full">
            <tbody>
              {CHAINS.map((c, i) => (
                <tr key={c.id} data-skeleton="" className={i % 2 ? "bg-bar" : ""}>
                  {COLS.map((w, j) => (
                    <td key={j} className={`px-2.5 py-2 ${j === 0 || j === 4 ? "hidden sm:table-cell" : ""}`}>
                      <Skel w={w} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        {(data) => (
          <div className={isDim(status) ? "is-dim" : ""}>
            <MobileRows data={data} now={now} boot={boot} />
            <table className="data hidden w-full whitespace-nowrap text-ink sm:table">
              <caption className="sr-only">Session state per chain from the indexer</caption>
              <thead>
                <tr className="text-left text-ink-2">
                  <th scope="col" className="px-2.5 pb-1 pt-2 font-normal">id</th>
                  <th scope="col" className="px-2.5 pb-1 pt-2 font-normal">chain</th>
                  <th scope="col" className="px-2.5 pb-1 pt-2 font-normal">clock</th>
                  <th scope="col" className="px-2.5 pb-1 pt-2 text-right font-normal">block</th>
                  <th scope="col" className="px-2.5 pb-1 pt-2 text-right font-normal">polled</th>
                </tr>
              </thead>
              <tbody>
                <Rows data={data} now={now} boot={boot} />
              </tbody>
            </table>
          </div>
        )}
      </SourceGate>
      <p className="border-t border-rule px-2.5 py-2 text-[14px] text-ink-2">
        <NextOpen />
      </p>
    </figure>
  );
}
