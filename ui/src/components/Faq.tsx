import type { ReactNode } from "react";
import { RightNowAges, RightNowRules } from "./RightNow";
import { repoFile } from "@/lib/config";
import { column } from "@/lib/styles";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "Is it live?",
    a: (
      <>
        On testnets, yes. The contracts run on Robinhood Chain, HyperEVM and Tempo testnets, and the indexer reads them every
        minute; the terminal above shows how old its last snapshot is. Prices are real Chainlink prints from Robinhood Chain
        mainnet. Funds are not real: tokens and some feeds are mocks, and nothing here is deployed to mainnet.
        <RightNowAges />
      </>
    ),
  },
  {
    q: "Is it audited?",
    a: (
      <>
        No. There is no external audit yet. What exists is an{" "}
        <a href={repoFile("docs/SECURITY_REVIEW.md")}>internal security review</a> dated 2026-10-10 (the README calls it a
        self-review), an <a href={repoFile("docs/audits/SLITHER_SUMMARY.md")}>automated Slither scan</a> with 0 high-severity
        findings, and 128 tests per the <a href={repoFile("README.md")}>README</a>. The review&apos;s own verdict is cleared for
        testnet, not for mainnet.
      </>
    ),
  },
  {
    q: "Which chains?",
    a: (
      <>
        Three testnets: Robinhood Chain (46630), HyperEVM (998) and Tempo (42431). Each has its own AnchorClock and Rulebook,
        polled every 60 seconds. Adapters read what each chain exposes: Chainlink feeds, pool TWAPs and liveness on Robinhood
        Chain, HyperCore precompiles on HyperEVM, stablecoin DEX quotes and TIP-403 policy on Tempo.
      </>
    ),
  },
  {
    q: "What happens when the market closes?",
    a: (
      <>
        The clock flips from the block timestamp alone, with no keeper transaction. The guarded feed stops quoting live prints
        and returns the last open print. The lender drops its maximum LTV from 50% to 35% and won&apos;t liquidate until the
        market has reopened and a grace window has passed. Repayments, debt-free withdrawals and refunds stay open.
        <RightNowRules />
      </>
    ),
  },
  {
    q: "Who pays?",
    a: (
      <>
        Reading is free: the indexer and Signal API are read-only and need no keys or gas. A keeper account pokes GuardedFeed
        and pays its own gas. The model in the code is venue-pays: ProtectionBilling takes a protection fee in a TIP-20
        stablecoin with an invoice memo. It exists on testnet only, and nothing bills anyone yet.
      </>
    ),
  },
  {
    q: "Can I get out?",
    a: (
      <>
        Yes. The Rulebook can&apos;t restrict exit actions: <code className="data">decision()</code> returns ALLOW for them
        unconditionally. Deferred swaps and settlement holds can be refunded at any time, and repay never reverts. Halts and
        emergency flags expire within 6 hours. This site is read-only: it never asks for a wallet or a key.
      </>
    ),
  },
  {
    q: "Who can change the rules?",
    a: (
      <>
        The venue admin publishes them. Tightening takes effect at once; loosening waits out a timelock. Emergency flags can
        only tighten, are rate-limited and expire. A QuorumFlagger contract adds M-of-N approval where a venue wants it.
      </>
    ),
  },
  {
    q: "What doesn't it do yet?",
    a: (
      <>
        Sessions are binary, open or closed: no pre-market, post-market or overnight phases. The routers don&apos;t call the
        Rulebook onchain; wiring it in is future work in the <a href={repoFile("README.md")}>README</a>, so today the Rulebook
        is policy that venues and the Signal API read. The calendar covers 2026 and 2027 only; outside it the clock is never
        open. Liquidation is full: it seizes all collateral and covers all debt. One known flaw: on Fed holidays between 20:00
        and 24:00 ET the Fed banking-day anchor can read open while the Fed is closed. It is permissive, affects about nine
        days a year, and is accepted until a redeploy (<a href={repoFile("docs/BANK_US_EDGE_CASE.md")}>BANK_US_EDGE_CASE.md</a>
        , <a href={repoFile("docs/SECURITY_REVIEW.md")}>SECURITY_REVIEW.md</a>).
      </>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-rule py-12 md:py-[72px]">
      <div className={column}>
        <h2 id="faq-title">Quick answers.</h2>
        <div className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {QA.map(({ q, a }) => (
            <div key={q} className="border-t border-ink pt-4">
              <h3 className="text-[17px]">{q}</h3>
              <p className="prose-col mt-2 text-ink-2">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
