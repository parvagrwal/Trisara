"use client";

import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { CHAINS, CONSUMER_ENTRIES, CONSUMER_NOTES, CORE_CONTRACTS, coreAddress, sourceFileFor } from "@/data/chains";
import { repoFile } from "@/lib/config";

function Row({ chainId, name, address, note }: { chainId: string; name: string; address: string; note?: string }) {
  const src = sourceFileFor(name);
  return (
    <tr className="border-t border-rule align-top">
      <td className="data py-2 pr-3 text-ink-2">{chainId}</td>
      <td className="py-2 pr-3">
        <span className="data block font-semibold">{name}</span>
        {note ? <span className="block text-[13px] text-ink-2">{note}</span> : null}
      </td>
      <td className="data break-all py-2 pr-3">{address}</td>
      <td className="py-2 pr-3">
        <CopyButton text={address} describe={`the ${name} address on chain ${chainId}`} />
      </td>
      <td className="whitespace-nowrap py-2 text-[14px]">
        {src ? <a href={repoFile(src)}>{src.split("/").pop()}</a> : null}
      </td>
    </tr>
  );
}

function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <caption className="pb-2 text-left font-mono text-[14px] font-semibold [font-stretch:87.5%]">{caption}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">chain id</th>
            <th scope="col">contract</th>
            <th scope="col">address</th>
            <th scope="col">copy</th>
            <th scope="col">source</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Addresses from deployments.generated.json, always with their chain id. */
export function Deployments() {
  return (
    <details className="border-y-2 border-ink">
      <summary className="tap flex min-h-12 items-center font-mono text-[15px] font-semibold [font-stretch:87.5%]">
        Deployments
      </summary>
      <div className="space-y-8 pb-6 pt-2">
        <p className="prose-col text-[14px] text-ink-2">
          Every address is testnet-only and belongs to the chain beside it. One deployer was used everywhere, so the same
          address can be a different contract on another chain.
        </p>
        {CHAINS.map((c) => (
          <Table key={c.id} caption={`${c.networkName} (${c.id})`}>
            {CORE_CONTRACTS.map((name) => {
              const a = coreAddress(c.id, name);
              return a ? <Row key={name} chainId={c.id} name={name} address={a} /> : null;
            })}
          </Table>
        ))}
        <Table caption="Robinhood Chain testnet (46630): consumers, adapters, mock tokens and feeds">
          {CONSUMER_ENTRIES.map(([name, address]) => (
            <Row
              key={name}
              chainId="46630"
              name={name}
              address={address}
              note={
                name === "GuardedSwapRouter"
                  ? "per the README, wired to GuardedFeed since the 2026-10-12 redeploy; check it with step 5 in Try it now"
                  : CONSUMER_NOTES[name]
              }
            />
          ))}
        </Table>
      </div>
    </details>
  );
}
