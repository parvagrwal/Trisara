const STEPS = [
  {
    title: "The calendar lives onchain.",
    body: "AnchorClock encodes the NYSE and Fed calendars for 2026 and 2027, with holidays, early closes and daylight saving, as bitmaps. A session state is a pure function of the block timestamp, so nothing has to be pushed, and a timestamp outside the calendar is never open.",
  },
  {
    title: "The clock judges the price first.",
    body: "PriceIntegrity reads the clock before it reads the oracle: closed is closed, whatever the feed says. Only in an open session does it check freshness, velocity and deviation, and anyone can replay the evaluation offchain.",
  },
  {
    title: "Venues commit to the weekend rule in advance.",
    body: "The Rulebook is a standalone contract any venue can query: one pre-published, bounded, auto-expiring rule per action class. Tightening is instant, loosening waits out a timelock, and with no rule published it fails closed to HALT.",
  },
  {
    title: "Guarded routers enforce it and keep exits open.",
    body: "GuardedFeed serves the last open print while the market is shut, collars dislocated prints and reverts when it can't vouch for a price; the swap, lending and settlement routers act on that state. Refunds, repayments and debt-free withdrawals can't be blocked.",
  },
];

/** Four numbered steps: a real sequence, so the numbers carry meaning. */
export function Steps() {
  return (
    <ol className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {STEPS.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[2.5ch_1fr] gap-x-4 border-t border-ink pt-4">
          <span aria-hidden="true" className="font-mono text-[19px] font-semibold text-ink-3 tnum">
            {i + 1}
          </span>
          <div>
            <h3>
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className="prose-col mt-2 text-ink-2">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
