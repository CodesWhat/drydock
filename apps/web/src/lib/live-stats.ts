/**
 * Live project numbers for the hero proof band. Fetched on the server through
 * Next's data cache (hourly revalidation), so nothing runs in the browser and
 * the CSP stays as it is. No count is ever written down here: a source that
 * fails or answers with something unusable is left out of the result.
 */

export type LiveStats = {
  stars?: number;
  forks?: number;
  openIssues?: number;
  downloads?: number;
};

export type LiveStatsSource = {
  /** GitHub "owner/repo". */
  repoSlug: string;
  /** Docker Hub "owner/name". */
  dockerImage: string;
};

type FetchLike = (
  input: string,
  init?: RequestInit & { next?: { revalidate: number } },
) => Promise<Response>;

export const LIVE_STATS_REVALIDATE_SECONDS = 3600;
export const LIVE_STATS_TIMEOUT_MS = 4000;

/** 245 -> "245", 1234 -> "1.2K", 234100 -> "234K", 1_250_000 -> "1.3M". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  const n = Math.floor(value);
  if (n < 1000) return String(n);
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (n < 10_000) return `${trim(n / 1000)}K`;
  if (n < 999_500) return `${Math.round(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(LIVE_STATS_TIMEOUT_MS),
    next: { revalidate: LIVE_STATS_REVALIDATE_SECONDS },
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

/**
 * `auth` is an optional GitHub credential read from the server environment by
 * the caller. It only ever goes out in a request header from the server.
 */
export async function fetchLiveStats(
  { repoSlug, dockerImage }: LiveStatsSource,
  { fetchImpl = fetch as FetchLike, auth }: { fetchImpl?: FetchLike; auth?: string } = {},
): Promise<LiveStats> {
  const github: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (auth) github.Authorization = `Bearer ${auth}`;
  // open_issues_count on the repo endpoint includes pull requests, so open
  // issues come from the search API with type:issue instead.
  const issuesQuery = encodeURIComponent(`repo:${repoSlug} type:issue state:open`);

  const [repo, issues, hub] = await Promise.allSettled([
    getJson(fetchImpl, `https://api.github.com/repos/${repoSlug}`, github),
    getJson(fetchImpl, `https://api.github.com/search/issues?q=${issuesQuery}&per_page=1`, github),
    getJson(fetchImpl, `https://hub.docker.com/v2/repositories/${dockerImage}`, {
      Accept: "application/json",
    }),
  ]);

  const stats: LiveStats = {};
  const put = (key: keyof LiveStats, value: number | undefined) => {
    if (value !== undefined) stats[key] = value;
  };
  if (repo.status === "fulfilled") {
    put("stars", count(field(repo.value, "stargazers_count")));
    put("forks", count(field(repo.value, "forks_count")));
  }
  if (issues.status === "fulfilled") put("openIssues", count(field(issues.value, "total_count")));
  if (hub.status === "fulfilled") put("downloads", count(field(hub.value, "pull_count")));
  return stats;
}
