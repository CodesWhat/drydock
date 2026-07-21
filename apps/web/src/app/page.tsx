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
import { StarHistory } from "@/components/star-history";
import { BASE_URL, GITHUB_RELEASES_URL, GITHUB_URL, SITE_CONFIG } from "@/lib/site-config";
import { faqItems } from "./data/faq";

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

  const faqPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <JsonLd data={softwareAppJsonLd} />
      <JsonLd data={websiteJsonLd} />
      <JsonLd data={faqPageJsonLd} />
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
          <StarHistory />
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
