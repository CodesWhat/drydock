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
  // Every incomplete outcome (failed page, non-array body, MAX_PAGES exhausted)
  // must fall back, not render a truncated series as the repo total.
  assert.doesNotMatch(starHistoryRouteSource, /page === 1 \? undefined : starredAt/u);
  const undefinedReturns = starHistoryRouteSource.match(/return undefined;/gu) ?? [];
  assert.ok(undefinedReturns.length >= 4, "expected each incomplete outcome to return undefined");
  // The series is only returned from the short-page branch — the one complete outcome.
  assert.equal((starHistoryRouteSource.match(/return starredAt;/gu) ?? []).length, 1);
  assert.match(starHistoryRouteSource, /batch\.length < PER_PAGE\) \{\n[^}]*return starredAt;/u);
  // One shared deadline across the whole pagination run.
  assert.match(starHistoryRouteSource, /AbortSignal\.timeout\(FETCH_DEADLINE_MS\)/u);
  assert.match(starHistoryRouteSource, /\{ headers, signal, next:/u);
});
