import type { MetadataRoute } from "next";
import { getComparisonRouteSlugs } from "@/lib/comparison-route-data";
import { BASE_URL } from "@/lib/site-config";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const generatedAt = new Date();

  const docPages = source.getPages().map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: generatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const comparePages = getComparisonRouteSlugs().map((slug) => ({
    url: `${BASE_URL}/compare/${slug}`,
    lastModified: generatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/compare`,
      lastModified: generatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    },
    ...comparePages,
    {
      url: `${BASE_URL}/security/trivy-supply-chain-march-2026`,
      lastModified: new Date("2026-03-22"),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    },
    ...docPages,
  ];
}
