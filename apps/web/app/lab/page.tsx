import { type BgPalette, BgSwitcher } from "@/components/bg-switcher";
import { CompareVariants } from "@/components/lab/compare-variants";
import { DemoVariants } from "@/components/lab/demo-variants";
import { EcosystemVariants } from "@/components/lab/ecosystem-variants";
import { FeaturesVariants } from "@/components/lab/features-variants";
import { FooterVariants } from "@/components/lab/footer-variants";
import { GetStartedSecureToggle } from "@/components/lab/getstarted-secure-toggle";
import { HeroVariants } from "@/components/lab/hero-variants";
import { RoadmapVariants } from "@/components/lab/roadmap-variants";
import { StarHistoryVariants } from "@/components/lab/starhistory-variants";
import { SiteBackground } from "@/components/site-background";

const VALID_PALETTES = new Set<BgPalette>(["ember", "ocean", "violet", "forest", "mono"]);

export const metadata = {
  title: "Drydock — Design Lab",
  robots: { index: false, follow: false },
};

export default async function Lab({ searchParams }: { searchParams: Promise<{ bg?: string }> }) {
  const { bg: rawBg } = await searchParams;
  const bg: BgPalette = VALID_PALETTES.has(rawBg as BgPalette) ? (rawBg as BgPalette) : "ember";

  return (
    <main data-bg={bg} className="relative min-h-screen">
      <SiteBackground />
      <BgSwitcher active={bg} />

      <div className="relative z-10">
        {/* Locked sections render clean (no lab chrome) */}
        <HeroVariants />
        <FeaturesVariants />
        <GetStartedSecureToggle />
        <DemoVariants />
        <RoadmapVariants />
        <StarHistoryVariants />
        <CompareVariants />
        <EcosystemVariants />
        <FooterVariants />

        <div className="h-24" />
      </div>
    </main>
  );
}
