import { HeroChips } from "./HeroChips";
import { SessionSlip } from "./SessionSlip";
import { RegionBoundary } from "./RegionBoundary";
import { REPO_URL } from "@/lib/config";
import { column, primaryButton, secondaryButton } from "@/lib/styles";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`${column} pb-12 pt-12 md:pb-[72px] md:pt-16`}>
      <h1 id="hero-title" className="max-w-[26ch] lg:max-w-none">
        <span className="block">Real-world assets came onchain without their clocks.</span>
        <span className="block">Trisara is the escapement.</span>
      </h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:gap-12">
        <div className="space-y-6">
          <p className="prose-col text-[17px] text-ink-2 md:text-[18px]">
            Session-aware infrastructure for tokenized stocks. Every trade checks the market session before it executes,
            so there are no liquidations on stale weekend prices and no Monday-open swaps at Friday&apos;s close.
          </p>
          <div className="space-y-2">
            <p className="font-mono text-[13px] text-ink-2 [font-stretch:87.5%]">Live on three testnets:</p>
            <HeroChips />
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="#try" className={primaryButton}>
              Try it now
            </a>
            <a href={REPO_URL} className={secondaryButton}>
              Read the contracts
            </a>
          </div>
        </div>
        <div className="min-w-0 self-start">
          <RegionBoundary name="session slip">
            <SessionSlip />
          </RegionBoundary>
        </div>
      </div>
    </section>
  );
}
