import { Steps } from "./Steps";
import { FreezeTimeline } from "./FreezeTimeline";
import { Pipeline } from "./Pipeline";
import { Replays } from "./Replays";
import { RegionBoundary } from "./RegionBoundary";
import { repoFile } from "@/lib/config";
import { column } from "@/lib/styles";
import { FREEZE, REPORT_PATH, THAWS, gapPct, thawSpreadMin } from "@/data/weekend1";

/** Weekend fact: gaps computed from the report's own prices, as absolute values to one decimal. */
function WeekendFact() {
  const gaps = THAWS.map((t) => Math.abs(gapPct(t)));
  const min = Math.min(...gaps).toFixed(1);
  const max = Math.max(...gaps).toFixed(1);
  const spread = Math.round(thawSpreadMin());
  return (
    <div className="border-y-2 border-ink py-5">
      <p className="prose-col text-[17px] leading-relaxed">
        Oct 3 to 5, 2026: three Chainlink equity feeds on Robinhood Chain mainnet published no new round for {FREEZE.hours}{" "}
        hours, then woke up about {spread} minutes apart, their first live prints between {min}% and {max}% away from
        Friday&apos;s frozen print. Nothing onchain could tell frozen from live.{" "}
        <a href={repoFile(REPORT_PATH)}>Read the weekend report</a>
      </p>
    </div>
  );
}

export function How() {
  return (
    <section id="how" aria-labelledby="how-title" className="border-t border-rule py-12 md:py-[72px]">
      <div className={column}>
        <h2 id="how-title">Every price is checked against the clock.</h2>
        <div className="mt-10">
          <Steps />
        </div>
        <div className="mt-14 space-y-4">
          <WeekendFact />
          <RegionBoundary name="freeze timeline">
            <FreezeTimeline />
          </RegionBoundary>
        </div>
        <div className="mt-16">
          <RegionBoundary name="pipeline">
            <Pipeline />
          </RegionBoundary>
        </div>
        <div className="mt-16">
          <RegionBoundary name="replays">
            <Replays />
          </RegionBoundary>
        </div>
      </div>
    </section>
  );
}
