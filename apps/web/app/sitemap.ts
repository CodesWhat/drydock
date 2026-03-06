import { statSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";
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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

  const docPages = source.getPages().map((page) => ({
    url: `${baseUrl}${page.url}`,
    lastModified: getFileModifiedDate(page),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const comparePages = [
    "watchtower",
    "diun",
    "ouroboros",
    "wud",
    "komodo",
    "dockge",
    "portainer",
    "dockhand",
    "dozzle",
  ].map((slug) => ({
    url: `${baseUrl}/compare/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/compare`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.9,
    },
    ...comparePages,
    ...docPages,
  ];
}
