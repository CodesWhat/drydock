import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const globalsSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const starHistorySource = readFileSync(
  new URL("../src/components/star-history.tsx", import.meta.url),
  "utf8",
);
const starHistoryChartSource = readFileSync(
  new URL("../src/components/star-history-chart.tsx", import.meta.url),
  "utf8",
);
const starHistoryRouteSource = readFileSync(
  new URL("../src/app/api/star-history/route.ts", import.meta.url),
  "utf8",
);

test("aurora drift is finite and does not retain a permanent compositor hint", () => {
  const motionRule = globalsSource.match(
    /\[data-aurora-motion="true"\] \.aurora-mesh \{(?<body>[\s\S]*?)\n\}/u,
  );

  assert.ok(motionRule?.groups?.body, "expected the marketing aurora motion rule");
  assert.doesNotMatch(motionRule.groups.body, /\binfinite\b/u);
  assert.doesNotMatch(motionRule.groups.body, /will-change/u);
});

test("star history keeps theme-aware image loading inside a narrow client component", () => {
  assert.doesNotMatch(starHistorySource, /^"use client"/mu);
  assert.match(starHistorySource, /import \{ StarHistoryChart \}/u);
  assert.match(starHistorySource, /<StarHistoryChart/u);
  assert.equal(starHistorySource.indexOf("api.star-history.com"), -1);
});

test("star history lazily loads only the active theme chart", () => {
  assert.match(starHistoryChartSource, /^"use client"/mu);
  assert.match(starHistoryChartSource, /useTheme/u);
  assert.match(starHistoryChartSource, /resolvedTheme === "dark" \? DARK_SRC : LIGHT_SRC/u);
  assert.equal((starHistoryChartSource.match(/<img\b/gu) ?? []).length, 1);
  assert.match(starHistoryChartSource, /loading="lazy"/u);
  assert.match(starHistoryChartSource, /decoding="async"/u);
  assert.match(starHistoryChartSource, /fetchPriority="low"/u);
});

test("star history chart is self-hosted, with no third-party chart service left", () => {
  assert.match(starHistoryChartSource, /\/api\/star-history\?theme=dark/u);
  assert.match(starHistoryChartSource, /\/api\/star-history\?theme=light/u);
  assert.equal(starHistoryChartSource.indexOf("star-history.com"), -1);
  assert.equal(starHistoryChartSource.indexOf("starchart.cc"), -1);
});

test("star history route never renders partial stargazer data and bounds its fetches", () => {
  // Every incomplete outcome (missing token, failed page, non-array edges,
  // MAX_PAGES exhausted) must fall back, not render a truncated series as the
  // repo total.
  assert.doesNotMatch(starHistoryRouteSource, /page === 1 \? undefined : starredAt/u);
  const undefinedReturns = starHistoryRouteSource.match(/return undefined;/gu) ?? [];
  assert.ok(undefinedReturns.length >= 4, "expected each incomplete outcome to return undefined");
  // The series is only returned from the last-page branch — the one complete outcome.
  assert.equal((starHistoryRouteSource.match(/return starredAt;/gu) ?? []).length, 1);
  assert.match(
    starHistoryRouteSource,
    /pageInfo\.hasNextPage === false\) \{\n[^}]*return starredAt;/u,
  );
  // Malformed pagination metadata must not read as "no more pages".
  assert.match(starHistoryRouteSource, /typeof pageInfo\?\.hasNextPage !== "boolean"/u);
  // An unparseable timestamp would undercount the series, so it fails the run.
  assert.match(starHistoryRouteSource, /!Number\.isFinite\(Date\.parse\(value\)\)/u);
  // GitHub is asked for at most PER_PAGE edges, and an oversized response is
  // rejected before it can grow the accumulated series past MAX_PAGES * PER_PAGE.
  assert.match(starHistoryRouteSource, /edges\.length > PER_PAGE/u);
  // One shared deadline across the whole pagination run.
  assert.match(starHistoryRouteSource, /AbortSignal\.timeout\(FETCH_DEADLINE_MS\)/u);
  assert.match(starHistoryRouteSource, /\n\s+signal,\n\s+next: \{ revalidate:/u);
});

test("star history route resolves an allowlisted repository before fetching", () => {
  assert.match(starHistoryRouteSource, /resolveStarHistoryRequest/u);
  assert.match(starHistoryRouteSource, /fetchStarredTimestamps\(repoSlug\)/u);
  assert.doesNotMatch(starHistoryRouteSource, /REPO_SLUG\.split/u);
  assert.match(starHistoryRouteSource, /status: 400/u);
  assert.match(starHistoryRouteSource, /"Cache-Control": "no-store"/u);
});

test("star history route reads stars through GraphQL, not the REST stargazers endpoint", () => {
  // REST /stargazers now 401s anonymously and demands contents=write from a
  // fine-grained token; the GraphQL connection needs only metadata=read.
  // A substring check, not a regex: an unanchored URL pattern reads as host
  // matching to CodeQL, and this only asserts the endpoint appears in source.
  assert.ok(starHistoryRouteSource.includes('"https://api.github.com/graphql"'));
  assert.equal(starHistoryRouteSource.indexOf("/stargazers?per_page="), -1);
  assert.match(starHistoryRouteSource, /orderBy:\{field:STARRED_AT,direction:ASC\}/u);
  // No token means no data at all, so the route must fall back rather than
  // render an empty chart.
  assert.match(starHistoryRouteSource, /if \(!token\) \{\n[^}]*return undefined;/u);
});
