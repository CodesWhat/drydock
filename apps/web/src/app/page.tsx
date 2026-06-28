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
import { BASE_URL, GITHUB_RELEASES_URL, GITHUB_URL, SITE_CONFIG } from "@/lib/site-config";

export const metadata: Metadata = {
  alternates: {
    canonical: BASE_URL,
  },
};

export default function Home() {
  const softwareAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_CONFIG.name,
    url: BASE_URL,
    description: "Open source container update monitoring built in TypeScript with modern tooling.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Docker",
    license: "https://opensource.org/licenses/AGPL-3.0",
    downloadUrl: GITHUB_RELEASES_URL,
    installUrl: GITHUB_RELEASES_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    sameAs: [GITHUB_URL, SITE_CONFIG.twitterUrl],
    author: {
      "@type": "Organization",
      name: "CodesWhat",
      url: "https://codeswhat.com",
      sameAs: ["https://github.com/CodesWhat"],
    },
    softwareHelp: {
      "@type": "WebPage",
      url: `${BASE_URL}/docs`,
    },
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_CONFIG.name,
    url: BASE_URL,
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
