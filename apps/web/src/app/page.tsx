import type { Metadata } from "next";
import { CompareSection } from "@/components/compare-section";
import { Demo } from "@/components/demo";
import { Ecosystem } from "@/components/ecosystem";
import { FAQ } from "@/components/faq";
import { Features } from "@/components/features";
import { GetStarted } from "@/components/get-started";
import { Hero } from "@/components/hero";
import { JsonLd } from "@/components/json-ld";
import { MarketingShell } from "@/components/marketing-shell";
import { Roadmap } from "@/components/roadmap";
import { BASE_URL } from "@/lib/site-config";
import { buildHomeJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  alternates: {
    canonical: BASE_URL,
  },
};

export default function Home() {
  return (
    <>
      <JsonLd data={buildHomeJsonLd()} />
      <MarketingShell>
        <Hero />
        <div className="reveal" suppressHydrationWarning>
          <Features />
        </div>
        <div className="reveal" suppressHydrationWarning>
          <GetStarted />
        </div>
        {/* Demo is left unwrapped: its fullscreen expand uses position:fixed,
            which a transformed `.reveal` ancestor would re-anchor and break. */}
        <Demo />
        <div className="reveal" suppressHydrationWarning>
          <Roadmap />
        </div>
        <div className="reveal" suppressHydrationWarning>
          <CompareSection />
        </div>
        <div className="reveal" suppressHydrationWarning>
          <Ecosystem />
        </div>
        <div className="reveal" suppressHydrationWarning>
          <FAQ />
        </div>
      </MarketingShell>
    </>
  );
}
