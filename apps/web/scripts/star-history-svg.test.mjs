import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCumulativeSeries,
  renderStarHistoryFallbackSvg,
  renderStarHistorySvg,
  resolveTheme,
} from "../src/lib/star-history-svg.mjs";

const NOW = Date.parse("2026-08-07T12:00:00Z");

test("resolveTheme only ever yields light or dark", () => {
  assert.equal(resolveTheme("dark"), "dark");
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("neon"), "light");
  assert.equal(resolveTheme(null), "light");
});

test("buildCumulativeSeries sorts, accumulates, and appends a now-point", () => {
  const series = buildCumulativeSeries(
    ["2026-03-02T00:00:00Z", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    NOW,
  );
  assert.equal(series.length, 4);
  assert.deepEqual(
    series.map((point) => point.count),
    [1, 2, 3, 3],
  );
  assert.equal(series[0].time, Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(series[3].time, NOW);
  // Monotonic time after sorting unordered input.
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].time >= series[i - 1].time);
  }
});

test("buildCumulativeSeries drops invalid timestamps and handles empty input", () => {
  const series = buildCumulativeSeries(["not-a-date", "2026-01-01T00:00:00Z"], NOW);
  assert.deepEqual(
    series.map((point) => point.count),
    [1, 1],
  );

  const empty = buildCumulativeSeries([], NOW);
  assert.deepEqual(empty, [{ time: NOW, count: 0 }]);

  assert.deepEqual(buildCumulativeSeries(undefined, "not-a-date"), []);
});

test("buildCumulativeSeries does not append when now precedes the last star", () => {
  const series = buildCumulativeSeries(
    ["2026-01-01T00:00:00Z"],
    Date.parse("2025-01-01T00:00:00Z"),
  );
  assert.equal(series.length, 1);
  assert.equal(series[0].count, 1);
});

test("renderStarHistorySvg draws the series with the accent line and ink-token text", () => {
  const series = buildCumulativeSeries(
    ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"],
    NOW,
  );
  const svg = renderStarHistorySvg({ series, theme: "light", repoSlug: "CodesWhat/drydock" });

  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(svg, /viewBox="0 0 720 480"/u);
  assert.match(svg, /stroke="#0284c7" stroke-width="2"/u);
  // Direct end label carries the total in ink, not the series color.
  assert.match(svg, /font-weight="600">3<\/text>/u);
  assert.match(svg, /aria-label="GitHub star history for CodesWhat\/drydock: 3 stars"/u);
  assert.match(svg, /Jan 2026/u);
  assert.match(svg, /Aug 2026/u);
  // No legend for a single series; the header names it instead.
  assert.match(svg, />GitHub stars<\/text>/u);
});

test("renderStarHistorySvg selects dark ink tokens for the dark theme", () => {
  const series = buildCumulativeSeries(["2026-01-01T00:00:00Z"], NOW);
  const dark = renderStarHistorySvg({ series, theme: "dark", repoSlug: "CodesWhat/drydock" });
  const light = renderStarHistorySvg({ series, theme: "light", repoSlug: "CodesWhat/drydock" });

  assert.match(dark, /fill="#f5f5f5"/u);
  assert.match(light, /fill="#171717"/u);
  // Same validated accent in both modes.
  assert.match(dark, /stroke="#0284c7"/u);
  assert.match(light, /stroke="#0284c7"/u);
});

test("renderStarHistorySvg escapes the repo slug in text and aria-label", () => {
  const svg = renderStarHistorySvg({
    series: buildCumulativeSeries([], NOW),
    theme: "light",
    repoSlug: "a&b<c>\"d'",
  });
  assert.match(svg, /a&amp;b&lt;c&gt;&quot;d&#39;/u);
  assert.doesNotMatch(svg, /a&b<c>/u);
});

test("renderStarHistorySvg with an empty series renders a flat zero chart without paths", () => {
  const svg = renderStarHistorySvg({ series: [], theme: "light", repoSlug: "CodesWhat/drydock" });
  assert.match(svg, /aria-label="GitHub star history for CodesWhat\/drydock: 0 stars"/u);
  assert.doesNotMatch(svg, /<path/u);
  assert.doesNotMatch(svg, /<circle/u);
});

test("y-axis ticks land on nice round values that cover the total", () => {
  const stars = Array.from({ length: 215 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + (i % 200))).toISOString(),
  );
  const svg = renderStarHistorySvg({
    series: buildCumulativeSeries(stars, NOW),
    theme: "light",
    repoSlug: "CodesWhat/drydock",
  });
  // 215 stars → tightest nice ceiling is 250 (step 50 × 5 ticks), so the
  // line fills the plot instead of floating under a 400 ceiling.
  assert.match(svg, />250<\/text>/u);
  assert.match(svg, />0<\/text>/u);
  assert.doesNotMatch(svg, />400<\/text>/u);
  assert.equal((svg.match(/<line /gu) ?? []).length, 6);
});

test("fallback SVG is theme-aware and names the repo", () => {
  const svg = renderStarHistoryFallbackSvg({ theme: "dark", repoSlug: "CodesWhat/drydock" });
  assert.match(svg, /temporarily unavailable/u);
  assert.match(svg, /fill="#a3a3a3"/u);
  assert.match(svg, /Star history is loading/u);
});
