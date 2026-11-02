import type { Metadata } from "next";
import { CompareMatrix } from "@/components/compare-matrix";
import { JsonLd } from "@/components/json-ld";
import { MarketingShell } from "@/components/marketing-shell";
import { BASE_URL, SITE_CONFIG } from "@/lib/site-config";
import { buildCompareIndexJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  // absolute: this title already carries the brand; opt out of the root "%s | Drydock" template.
  title: { absolute: "Drydock vs Alternatives — Container Update Tool Comparisons" },
  description:
    "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, WUD, and Arcane. Feature-by-feature breakdowns for container update monitoring tools.",
  keywords: [
    "watchtower alternative",
    "portainer alternative",
    "diun alternative",
    "arcane alternative",
    "container update monitoring comparison",
    "docker update tools",
    "watchtower replacement",
    "watchtower archived",
  ],
  openGraph: {
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, and more. Feature-by-feature breakdowns.",
    url: `${BASE_URL}/compare`,
    siteName: SITE_CONFIG.name,
    locale: SITE_CONFIG.locale,
    type: "website",
    images: [
      {
        url: SITE_CONFIG.ogImage,
        width: 1200,
        height: 630,
        alt: "Drydock vs Alternatives — Container Update Tool Comparisons",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description: "Compare Drydock to Watchtower, Portainer, Diun, and more.",
    creator: SITE_CONFIG.twitterCreator,
    images: [SITE_CONFIG.ogImage],
  },
  alternates: {
    canonical: `${BASE_URL}/compare`,
  },
};

const tools = [
  { name: "Arcane", slug: "arcane" },
  { name: "Portainer", slug: "portainer" },
  { name: "Komodo", slug: "komodo" },
  { name: "Diun", slug: "diun" },
  { name: "Dockge", slug: "dockge" },
  { name: "Dockhand", slug: "dockhand" },
  { name: "Dozzle", slug: "dozzle" },
  { name: "WUD", slug: "wud" },
  { name: "Watchtower", slug: "watchtower" },
  { name: "Ouroboros", slug: "ouroboros" },
];

export default function ComparePage() {
  const jsonLd = buildCompareIndexJsonLd(tools, {
    name: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, WUD, and Arcane.",
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <MarketingShell>
        {/* Hero */}
        <section className="pt-16 pb-12">
          <div className="website-wrap">
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-[var(--dd-text)] sm:text-5xl dark:text-[var(--dd-text)]">
              Drydock vs Alternatives
            </h1>
            <p className="max-w-2xl text-lg text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
              We built Drydock to go further than any existing container update tool. Click any tool
              to see exactly how we compare.
            </p>
          </div>
        </section>

        {/* Full comparison matrix */}
        <section className="pb-24">
          <div className="website-wrap">
            <h2 className="sr-only">Compare Drydock with each tool</h2>
            <CompareMatrix />
          </div>
        </section>
      </MarketingShell>
    </>
  );
}
