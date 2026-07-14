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
