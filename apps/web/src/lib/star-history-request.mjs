const CANONICAL_ORIGIN = "https://getdrydock.com";
const DEFAULT_REPO = "CodesWhat/drydock";
const ALLOWED_REPOS = new Set([DEFAULT_REPO, "CodesWhat/sockguard", "CodesWhat/portwing"]);
const ALLOWED_THEMES = new Set(["light", "dark"]);

function isAllowedRepo(repoSlug) {
  return ALLOWED_REPOS.has(repoSlug);
}

function isAllowedTheme(theme) {
  return ALLOWED_THEMES.has(theme);
}

export function resolveStarHistoryRequest(searchParams) {
  const keys = [...searchParams.keys()];
  if (
    keys.some((key) => key !== "repo" && key !== "theme") ||
    searchParams.getAll("repo").length > 1 ||
    searchParams.getAll("theme").length > 1
  ) {
    return undefined;
  }

  const repoParam = searchParams.get("repo");
  const themeParam = searchParams.get("theme");
  const repoSlug = repoParam === null ? DEFAULT_REPO : repoParam;
  const theme = themeParam === null ? "light" : themeParam;

  if (!isAllowedRepo(repoSlug) || !isAllowedTheme(theme)) {
    return undefined;
  }

  return { repoSlug, theme };
}

export function buildStarHistoryUrl(repoSlug, theme) {
  if (!isAllowedRepo(repoSlug)) {
    throw new TypeError(`Unsupported repo: ${repoSlug}`);
  }
  if (!isAllowedTheme(theme)) {
    throw new TypeError(`Unsupported theme: ${theme}`);
  }

  const url = new URL("/api/star-history", CANONICAL_ORIGIN);
  if (repoSlug !== DEFAULT_REPO) {
    url.searchParams.set("repo", repoSlug);
  }
  url.searchParams.set("theme", theme);
  return url.toString();
}
