import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const compareSlugs = [
  "komodo",
  "portainer",
  "watchtower",
  "ouroboros",
  "dozzle",
  "wud",
  "dockhand",
  "diun",
  "dockge",
];

const comparisonRouteData = new URL("../lib/comparison-route-data.tsx", import.meta.url);

function readPage(url) {
  return readFileSync(url, "utf8");
}

test("All comparison pages delegate page data to shared comparison-route-data", () => {
  for (const slug of compareSlugs) {
    const source = readPage(new URL(`../app/compare/${slug}/page.tsx`, import.meta.url));

    assert.match(source, /from "@\/lib\/comparison-route-data"/);
    assert.match(source, /from "@\/lib\/comparison-route"/);
    assert.match(source, /\bcreateComparisonRoute\(/);
    assert.match(source, new RegExp(`getComparisonRouteConfig\\("${slug}"\\)`));

    assert.doesNotMatch(source, /\browsFromPipeTable\(/);
    assert.doesNotMatch(source, /\bhighlightsFromPipeTable\(/);
    assert.doesNotMatch(source, /\bmetadataKeywords:\s*\[/);
  }
});

test("comparison-route-data defines all compare page slugs", () => {
  const source = readPage(comparisonRouteData);

  for (const slug of compareSlugs) {
    assert.match(source, new RegExp(`from "\\./comparison-route-data/${slug}"`));
    assert.match(source, new RegExp(`\\b${slug}:\\s*${slug}ComparisonRouteData\\b`));
  }

  assert.match(source, /\bexport function getComparisonRouteConfig\b/);
  assert.match(source, /\bexport function getComparisonRouteSlugs\b/);
});
