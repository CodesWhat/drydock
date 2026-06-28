import { statSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";
import { getComparisonRouteSlugs } from "@/lib/comparison-route-data";
import { BASE_URL } from "@/lib/site-config";
import { source } from "@/lib/source";

const contentDir = join(process.cwd(), "content", "docs");

function getFileModifiedDate(page: { absolutePath?: string; path: string }): Date {
  const filePath = page.absolutePath ?? join(contentDir, page.path);
  try {
    return statSync(filePath).mtime;
  } catch {
    return new Date();
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const docPages = source.getPages().map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: getFileModifiedDate(page),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const comparePages = getComparisonRouteSlugs().map((slug) => ({
    url: `${BASE_URL}/compare/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/compare`,
      lastModified: new Date(),
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
