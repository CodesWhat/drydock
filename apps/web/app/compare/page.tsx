import type { Metadata } from "next";
import { CompareMatrix } from "@/components/compare-matrix";
import { MarketingShell } from "@/components/marketing-shell";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com";

export const metadata: Metadata = {
  title: "Drydock vs Alternatives — Container Update Tool Comparisons",
  description:
    "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, and WUD. Feature-by-feature breakdowns for container update monitoring tools.",
  keywords: [
    "watchtower alternative",
    "portainer alternative",
    "diun alternative",
    "container update monitoring comparison",
    "docker update tools",
    "watchtower replacement",
    "watchtower archived",
  ],
  openGraph: {
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, and more. Feature-by-feature breakdowns.",
    url: `${baseUrl}/compare`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description: "Compare Drydock to Watchtower, Portainer, Diun, and more.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare`,
  },
};

const tools = [
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
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, and WUD.",
    url: `${baseUrl}/compare`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: tools.length,
      itemListElement: tools.map((tool, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${baseUrl}/compare/${tool.slug}`,
        name: `${tool.name} vs Drydock`,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingShell>
        {/* Hero */}
        <section className="px-4 pt-16 pb-12">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
              Drydock vs Alternatives
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
              We built Drydock to go further than any existing container update tool. Click any tool
              to see exactly how we compare.
            </p>
          </div>
        </section>

        {/* Full comparison matrix */}
        <section className="px-4 pb-24">
          <div className="mx-auto max-w-5xl">
            <CompareMatrix />
          </div>
        </section>
      </MarketingShell>
    </>
  );
}
