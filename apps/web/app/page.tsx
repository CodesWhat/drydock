import { CompareVariants } from "@/components/lab/compare-variants";
import { DemoVariants } from "@/components/lab/demo-variants";
import { EcosystemVariants } from "@/components/lab/ecosystem-variants";
import { FeaturesVariants } from "@/components/lab/features-variants";
import { GetStartedSecureToggle } from "@/components/lab/getstarted-secure-toggle";
import { HeroVariants } from "@/components/lab/hero-variants";
import { RoadmapVariants } from "@/components/lab/roadmap-variants";
import { StarHistoryVariants } from "@/components/lab/starhistory-variants";
import { MarketingShell } from "@/components/marketing-shell";

export default function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Drydock",
    url: baseUrl,
    description: "Open source container update monitoring built in TypeScript with modern tooling.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Docker",
    license: "https://opensource.org/licenses/AGPL-3.0",
    author: {
      "@type": "Organization",
      name: "CodesWhat",
      url: "https://codeswhat.com",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingShell>
        <HeroVariants />
        <FeaturesVariants />
        <GetStartedSecureToggle />
        <DemoVariants />
        <RoadmapVariants />
        <StarHistoryVariants />
        <CompareVariants />
        <EcosystemVariants />
      </MarketingShell>
    </>
  );
}
