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

// GraphQL rather than REST /stargazers: that endpoint now 401s without a token
// and, for a fine-grained token, demands `contents=write` — far more than a
// public star chart should hold. The GraphQL connection needs only
// `metadata=read`, and returns starredAt directly.
const STARGAZERS_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    stargazers(first:$first,after:$after,orderBy:{field:STARRED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      edges{starredAt}
    }
  }
}`;

type StargazerPage = {
  pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
  edges?: unknown;
};

async function fetchStarredTimestamps(): Promise<string[] | undefined> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // The GraphQL API has no anonymous mode, so an unconfigured deployment
    // falls back rather than silently rendering an empty chart.
    return undefined;
  }

  const [owner, name] = REPO_SLUG.split("/");
  if (!owner || !name) {
    return undefined;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "drydock-website-star-history",
  };

  const signal = AbortSignal.timeout(FETCH_DEADLINE_MS);
  const starredAt: string[] = [];
  let after: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let payload: unknown;
    try {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: STARGAZERS_QUERY,
          variables: { owner, name, first: PER_PAGE, after },
        }),
        signal,
        next: { revalidate: 21600 },
      });
      if (!response.ok) {
        return undefined;
      }
      payload = await response.json();
    } catch {
      return undefined;
    }

    const body = payload as { data?: { repository?: { stargazers?: StargazerPage } } };
    const stargazers = body?.data?.repository?.stargazers;
    const edges = stargazers?.edges;
    if (!Array.isArray(edges)) {
      // Missing data means an error payload or a shape change; either way the
      // series would be incomplete.
      return undefined;
    }

    for (const edge of edges) {
      const value = (edge as { starredAt?: unknown })?.starredAt;
      if (typeof value === "string") {
        starredAt.push(value);
      }
    }

    if (stargazers?.pageInfo?.hasNextPage !== true) {
      // The last page is the only complete outcome.
      return starredAt;
    }

    const cursor = stargazers.pageInfo.endCursor;
    if (typeof cursor !== "string") {
      return undefined;
    }
    after = cursor;
  }

  // MAX_PAGES exhausted with hasNextPage still true: history continues, so the
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
