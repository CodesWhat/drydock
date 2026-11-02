/** Published security advisories. The /security index, sitemap and JSON-LD all read this list. */
export type Advisory = {
  slug: string;
  title: string;
  summary: string;
  status: string;
  /** ISO date (YYYY-MM-DD). */
  datePublished: string;
  /** ISO date (YYYY-MM-DD). The same value feeds JSON-LD and the sitemap. */
  dateModified: string;
};

export const ADVISORIES: Advisory[] = [
  {
    slug: "trivy-supply-chain-march-2026",
    title: "Trivy Supply Chain Compromise",
    summary:
      "Analysis of the March 2026 Trivy supply chain breach (GHSA-69fq-xp46-6x23). Drydock is not affected. Full audit and recommendations for users.",
    status: "Not affected",
    datePublished: "2026-03-22",
    dateModified: "2026-07-18",
  },
];

export function getAdvisory(slug: string): Advisory {
  const advisory = ADVISORIES.find((entry) => entry.slug === slug);
  if (!advisory) throw new Error(`Unknown advisory: ${slug}`);
  return advisory;
}
