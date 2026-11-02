import type { MetadataRoute } from "next";
import { getComparisonRouteSlugs } from "@/lib/comparison-route-data";
import { BASE_URL, DOCS_ROOT } from "@/lib/site-config";
import { source } from "@/lib/source";

// Only the current docs version is listed. Archived versions stay reachable
// but are not submitted, so they don't compete with the current pages. There is
// no per-page modified date to read at runtime, so lastModified is omitted
// rather than stamped with the request time.
const isCurrentDocsPage = (url: string) => url === DOCS_ROOT || url.startsWith(`${DOCS_ROOT}/`);

export default function sitemap(): MetadataRoute.Sitemap {
  const docPages = source
    .getPages()
    .filter((page) => isCurrentDocsPage(page.url))
    .map((page) => ({ url: `${BASE_URL}${page.url}` }));

  const comparePages = getComparisonRouteSlugs().map((slug) => ({
    url: `${BASE_URL}/compare/${slug}`,
  }));

  return [
    { url: BASE_URL },
    { url: `${BASE_URL}/compare` },
    ...comparePages,
    {
      url: `${BASE_URL}/security/trivy-supply-chain-march-2026`,
      lastModified: new Date("2026-03-22"),
    },
    ...docPages,
  ];
}
