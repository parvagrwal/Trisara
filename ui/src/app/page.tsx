import { AccessPoints } from "@/components/AccessPoints";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { How } from "@/components/How";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { Nav } from "@/components/Nav";
import { RegionBoundary } from "@/components/RegionBoundary";
import { SprocketRail } from "@/components/SprocketRail";
import { Terminal } from "@/components/Terminal";
import { Try } from "@/components/Try";
import { Waitlist } from "@/components/Waitlist";
import { INDEXER_STATE_URL, SIGNAL_STATE_URL } from "@/lib/config";
import { column } from "@/lib/styles";

// Server component: static copy only. Every market number is fetched on the client.
export default function Page() {
  return (
    <>
      <div id="top" />
      <a href="#main" className="sr-only-focusable">
        Skip to content
      </a>
      <SprocketRail />
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        <noscript>
          <div className={`${column} pt-6`}>
            <div className="border-2 border-ink p-4">
              <p className="font-semibold">Live telemetry needs JavaScript.</p>
              <p className="mt-1 text-ink-2">Read the same data from a terminal:</p>
              <pre className="data mt-2 overflow-x-auto whitespace-pre">{`curl -s ${INDEXER_STATE_URL}\ncurl -s ${SIGNAL_STATE_URL}`}</pre>
            </div>
          </div>
        </noscript>

        <Hero />

        <section id="terminal" aria-labelledby="terminal-title" className="border-t border-rule py-12 md:py-[72px]">
          <div className={column}>
            <h2 id="terminal-title">Live from three chains.</h2>
            <p className="prose-col mt-3 text-ink-2">
              Read straight from the indexer and the Signal API. Nothing trades. Prices are Chainlink on Robinhood Chain
              mainnet; clock and rules are read from the testnet contracts.
            </p>
            <div className="mt-8">
              <RegionBoundary name="terminal">
                <Terminal />
              </RegionBoundary>
            </div>
            <RegionBoundary name="access points">
              <AccessPoints />
            </RegionBoundary>
          </div>
        </section>

        <How />

        <section id="try" aria-labelledby="try-title" className="border-t border-rule py-12 md:py-[72px]">
          <div className={column}>
            <h2 id="try-title">Try it now.</h2>
            <p className="prose-col mt-3 text-ink-2">Read the contracts yourself. No wallet, no signup.</p>
            <div className="mt-8">
              <Try />
            </div>
          </div>
        </section>

        <Faq />
        <Waitlist />
      </main>
      <Footer />
      <LiveAnnouncer />
    </>
  );
}
