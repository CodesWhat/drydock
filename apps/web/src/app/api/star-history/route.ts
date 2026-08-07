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
// 3,000 stars of headroom; a run that would need more pages is treated as
// incomplete and falls back rather than rendering a truncated total.
const MAX_PAGES = 30;
// One deadline for the whole pagination run, so a stalled GitHub request
// can't hold the SVG response until the platform timeout.
const FETCH_DEADLINE_MS = 10_000;
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

  const signal = AbortSignal.timeout(FETCH_DEADLINE_MS);
  const starredAt: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let batch: unknown;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO_SLUG}/stargazers?per_page=${PER_PAGE}&page=${page}`,
        { headers, signal, next: { revalidate: 21600 } },
      );
      if (!response.ok) {
        return undefined;
      }
      batch = await response.json();
    } catch {
      return undefined;
    }
    if (!Array.isArray(batch)) {
      return undefined;
    }
    for (const entry of batch) {
      const value = (entry as { starred_at?: unknown })?.starred_at;
      if (typeof value === "string") {
        starredAt.push(value);
      }
    }
    if (batch.length < PER_PAGE) {
      // A short page is the end of the history — the only complete outcome.
      return starredAt;
    }
  }
  // MAX_PAGES exhausted with a full final page: history may continue, so the
  // series is incomplete. Fall back instead of caching a truncated total.
  return undefined;
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
