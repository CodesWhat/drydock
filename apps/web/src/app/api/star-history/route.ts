import { REPO_SLUG } from "@/lib/site-config";
import {
  buildCumulativeSeries,
  renderStarHistoryFallbackSvg,
  renderStarHistorySvg,
  resolveTheme,
} from "@/lib/star-history-svg.mjs";

// Self-hosted replacement for the api.star-history.com embed (#671): fetches
// stargazer timestamps server-side and renders the SVG from our own origin,
// so the homepage card and the README no longer depend on a third party.

export const runtime = "nodejs";

const PER_PAGE = 100;
// 3,000 stars of headroom; past that the chart thins visually anyway and the
// cap keeps a pathological pagination loop from burning the rate limit.
const MAX_PAGES = 30;
const SUCCESS_CACHE = "public, s-maxage=21600, stale-while-revalidate=604800";
const FAILURE_CACHE = "public, s-maxage=300";

async function fetchStarredTimestamps(): Promise<string[] | undefined> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.star+json",
    "User-Agent": "drydock-website-star-history",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const starredAt: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let batch: unknown;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO_SLUG}/stargazers?per_page=${PER_PAGE}&page=${page}`,
        { headers, next: { revalidate: 21600 } },
      );
      if (!response.ok) {
        // A partial series still renders an honest chart shape; only a
        // first-page failure means we have nothing to draw.
        return page === 1 ? undefined : starredAt;
      }
      batch = await response.json();
    } catch {
      return page === 1 ? undefined : starredAt;
    }
    if (!Array.isArray(batch)) {
      return page === 1 ? undefined : starredAt;
    }
    for (const entry of batch) {
      const value = (entry as { starred_at?: unknown })?.starred_at;
      if (typeof value === "string") {
        starredAt.push(value);
      }
    }
    if (batch.length < PER_PAGE) {
      break;
    }
  }
  return starredAt;
}

export async function GET(request: Request) {
  const theme = resolveTheme(new URL(request.url).searchParams.get("theme"));
  const starredAt = await fetchStarredTimestamps();

  if (starredAt === undefined) {
    return new Response(renderStarHistoryFallbackSvg({ theme, repoSlug: REPO_SLUG }), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": FAILURE_CACHE,
      },
    });
  }

  const series = buildCumulativeSeries(starredAt, Date.now());
  return new Response(renderStarHistorySvg({ series, theme, repoSlug: REPO_SLUG }), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": SUCCESS_CACHE,
    },
  });
}
