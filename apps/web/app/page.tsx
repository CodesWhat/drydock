import type { Metadata } from "next";
import { CompareVariants } from "@/components/lab/compare-variants";
import { DemoVariants } from "@/components/lab/demo-variants";
import { EcosystemVariants } from "@/components/lab/ecosystem-variants";
import { FeaturesVariants } from "@/components/lab/features-variants";
import { GetStartedSecureToggle } from "@/components/lab/getstarted-secure-toggle";
import { HeroVariants } from "@/components/lab/hero-variants";
import { RoadmapVariants } from "@/components/lab/roadmap-variants";
import { StarHistoryVariants } from "@/components/lab/starhistory-variants";
import { MarketingShell } from "@/components/marketing-shell";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com";

export const metadata: Metadata = {
  alternates: {
    canonical: baseUrl,
  },
};

export default function Home() {
  const softwareAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Drydock",
    url: baseUrl,
    description: "Open source container update monitoring built in TypeScript with modern tooling.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Docker",
    license: "https://opensource.org/licenses/AGPL-3.0",
    downloadUrl: "https://github.com/CodesWhat/drydock/releases",
    installUrl: "https://github.com/CodesWhat/drydock/releases",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    sameAs: ["https://github.com/CodesWhat/drydock", "https://x.com/codeswhat"],
    author: {
      "@type": "Organization",
      name: "CodesWhat",
      url: "https://codeswhat.com",
      sameAs: ["https://github.com/CodesWhat"],
    },
    softwareHelp: {
      "@type": "WebPage",
      url: `${baseUrl}/docs`,
    },
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Drydock",
    url: baseUrl,
    publisher: {
      "@type": "Organization",
      name: "CodesWhat",
      url: "https://codeswhat.com",
      sameAs: ["https://github.com/CodesWhat"],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <MarketingShell>
        <HeroVariants />
        <div className="reveal">
          <FeaturesVariants />
        </div>
        <div className="reveal">
          <GetStartedSecureToggle />
        </div>
        {/* Demo is left unwrapped: its fullscreen expand uses position:fixed,
            which a transformed `.reveal` ancestor would re-anchor and break. */}
        <DemoVariants />
        <div className="reveal">
          <RoadmapVariants />
        </div>
        <div className="reveal">
          <StarHistoryVariants />
        </div>
        <div className="reveal">
          <CompareVariants />
        </div>
        <div className="reveal">
          <EcosystemVariants />
        </div>
      </MarketingShell>
    </>
  );
}
