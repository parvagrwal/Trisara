"use client";

import { ActionChip } from "./ActionChip";
import { Flash } from "./Flash";
import { DownGlyph } from "./Glyphs";
import { Skel } from "./Skeleton";
import { Tip } from "./Tip";
import { CHAINS } from "@/data/chains";
import { fmtParam } from "@/lib/format";
import { actionIndex, CLASSES, isRuleOk, type ChainState, type IndexerState, type Rule } from "@/lib/types";

const th = "px-2.5 pb-1.5 pt-1 text-left font-normal text-platen-dim";
const td = "px-2.5 py-2 align-top";

export function RulebookSkeleton() {
  return (
    <table className="data w-full">
      <tbody>
        {CHAINS.map((c, i) => (
          <tr key={c.id} data-skeleton="" className={i % 2 ? "bg-platen-band" : ""}>
            {["11ch", "8ch", "8ch", "8ch", "8ch"].map((w, j) => (
              <td key={j} className={td}>
                <Skel w={w} />
                {j > 0 ? (
                  <span className="mt-1.5 block">
                    <Skel w="6ch" />
                  </span>
                ) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RuleCell({ rule }: { rule: Rule | undefined }) {
  if (!rule) return <span className="text-platen-dim">—</span>;
  if (!isRuleOk(rule)) {
    return (
      <Tip content={rule.error}>
        <span className="text-halt-t">read error</span>
      </Tip>
    );
  }
  const param = fmtParam(rule.action, rule.param);
  return (
    <Flash value={`${rule.action}/${rule.param}/${rule.reason}`} className="-mx-1 block px-1">
      <ActionChip action={rule.action} surface="platen" />
      <span className="block text-platen-text">{param || "\u00a0"}</span>
      <span className="block text-[11.5px] text-platen-dim">{rule.reason || "no reason"}</span>
    </Flash>
  );
}

const cellTitle = (chainName: string, cls: string, rule: Rule | undefined) =>
  isRuleOk(rule)
    ? `Rulebook.decision(0x00…00, ${cls}) on ${chainName}: action ${actionIndex(rule.action)}, param ${rule.param}, reason ${rule.reason || "(empty)"}`
    : undefined;

function RowStatus({ chain }: { chain: ChainState | undefined }) {
  if (!chain) return <span className="text-platen-dim">not in this snapshot</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-halt-t">
      <DownGlyph size={10} />
      <span className="font-semibold">down</span>
      <span className="text-platen-dim">no rules read</span>
    </span>
  );
}

export function RulebookMatrix({ data, boot }: { data: IndexerState; boot: boolean }) {
  const printStyle = (i: number) => (boot ? { animationDelay: `${(i + 4) * 60}ms` } : undefined);
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="data w-full whitespace-nowrap">
          <caption className="sr-only">Rulebook decision for the wildcard asset, per chain and action class</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>chain</th>
              {CLASSES.map((cls) => (
                <th key={cls} scope="col" className={th}>
                  {cls}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHAINS.map((c, i) => {
              const chain = data.chains[c.id];
              const rowCls = `${i % 2 === 1 ? "bg-platen-band" : ""} ${boot ? "print-row" : ""}`;
              const rules = chain && chain.healthy ? chain.rules : undefined;
              return (
                <tr key={c.id} className={rowCls} style={printStyle(i)}>
                  <th scope="row" className={`${td} text-left font-normal`}>
                    <span className="block">{c.name}</span>
                    <span className="block text-[11.5px] text-platen-dim">{c.id}</span>
                  </th>
                  {rules ? (
                    CLASSES.map((cls) => (
                      <td key={cls} className={td} title={cellTitle(c.name, cls, rules[cls])}>
                        <RuleCell rule={rules[cls]} />
                      </td>
                    ))
                  ) : (
                    <td className={td} colSpan={4}>
                      <RowStatus chain={chain} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="data divide-y divide-platen-rule sm:hidden" aria-label="Rulebook decision for the wildcard asset, per chain">
        {CHAINS.map((c, i) => {
          const chain = data.chains[c.id];
          const rules = chain && chain.healthy ? chain.rules : undefined;
          return (
            <li key={c.id} className={`space-y-2 py-2.5 ${boot ? "print-row" : ""}`} style={printStyle(i)}>
              <p>
                <span className="text-platen-dim">{c.id}</span> <span className="font-semibold">{c.name}</span>
              </p>
              {rules ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {CLASSES.map((cls) => (
                    <div key={cls} title={cellTitle(c.name, cls, rules[cls])}>
                      <dt className="text-platen-dim">{cls}</dt>
                      <dd>
                        <RuleCell rule={rules[cls]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <RowStatus chain={chain} />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
