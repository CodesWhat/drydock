import { getComparisonRouteConfig, getComparisonRouteSlugs } from "@/lib/comparison-route-data";
import { buildLlmsTxt, type LlmsLink } from "@/lib/llms-txt";
import {
  BASE_URL,
  DOCKER_HUB_URL,
  DOCS_ROOT,
  DOCS_VERSION,
  GITHUB_RELEASES_URL,
  GITHUB_URL,
  SITE_CONFIG,
} from "@/lib/site-config";
import { source } from "@/lib/source";

export const dynamic = "force-static";

// Docs entries come from the current docs tree, so a page that is renamed or
// removed drops out of the file instead of leaving a dead link behind.
const DOC_SLUGS = ["quickstart", "getting-started", "faq", "guides/security"];

export function GET() {
  const docs: LlmsLink[] = [{ title: "Documentation home", url: `${BASE_URL}${DOCS_ROOT}` }];
  for (const slug of DOC_SLUGS) {
    const page = source.getPage([DOCS_VERSION, ...slug.split("/")]);
    if (page) docs.push({ title: page.data.title, url: `${BASE_URL}${page.url}` });
  }

  const comparisons: LlmsLink[] = [
    { title: "All comparisons", url: `${BASE_URL}/compare` },
    ...getComparisonRouteSlugs().map((slug) => ({
      title: `Drydock vs ${getComparisonRouteConfig(slug).competitorName}`,
      url: `${BASE_URL}/compare/${slug}`,
    })),
  ];

  const body = buildLlmsTxt({
    name: SITE_CONFIG.name,
    description: SITE_CONFIG.description,
    docs,
    comparisons,
    project: [
      { title: "GitHub repository", url: GITHUB_URL },
      { title: "Releases", url: GITHUB_RELEASES_URL },
      { title: "Docker Hub image", url: DOCKER_HUB_URL },
      { title: "Security advisories", url: `${BASE_URL}/security` },
      {
        title: "Trivy supply chain advisory (March 2026)",
        url: `${BASE_URL}/security/trivy-supply-chain-march-2026`,
      },
    ],
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
