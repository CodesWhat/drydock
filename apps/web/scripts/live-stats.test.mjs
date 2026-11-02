import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fetchLiveStats, formatCount } from "../src/lib/live-stats.ts";

const SOURCE = { repoSlug: "Acme/widget", dockerImage: "acme/widget" };
const proofSource = readFileSync(
  new URL("../src/components/github-badges.tsx", import.meta.url),
  "utf8",
);
const statsSource = readFileSync(new URL("../src/lib/live-stats.ts", import.meta.url), "utf8");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Routes by URL. Each route is a body, a status override, or a function that throws.
function fakeFetch({ repo, issues, hub }, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const route = url.includes("/search/issues") ? issues : url.includes("/repos/") ? repo : hub;
    if (typeof route === "function") return route();
    return route;
  };
}

test("formatCount renders 245 and 234K the way the mock does", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(245), "245");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1K");
  assert.equal(formatCount(1234), "1.2K");
  assert.equal(formatCount(9999), "10K");
  assert.equal(formatCount(234_100), "234K");
  assert.equal(formatCount(741_831), "742K");
  assert.equal(formatCount(999_600), "1M");
  assert.equal(formatCount(1_250_000), "1.3M");
});

test("formatCount refuses non-counts instead of printing them", () => {
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) assert.equal(formatCount(bad), "");
});

test("fetchLiveStats reads stars, forks, issues-only and downloads from the right endpoints", async () => {
  const calls = [];
  const stats = await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch(
      {
        repo: json({ stargazers_count: 11, forks_count: 3, open_issues_count: 99 }),
        issues: json({ total_count: 4 }),
        hub: json({ pull_count: 2500 }),
      },
      calls,
    ),
  });
  assert.deepEqual(stats, { stars: 11, forks: 3, openIssues: 4, downloads: 2500 });
  const urls = calls.map((call) => call.url);
  assert.ok(urls.includes("https://api.github.com/repos/Acme/widget"));
  assert.ok(urls.includes("https://hub.docker.com/v2/repositories/acme/widget"));
  const search = urls.find((url) => url.includes("/search/issues"));
  assert.match(decodeURIComponent(search), /repo:Acme\/widget type:issue state:open/);
  for (const call of calls) {
    assert.equal(call.init.next.revalidate, 3600);
    assert.ok(call.init.signal instanceof AbortSignal, "every request carries a timeout signal");
  }
});

test("open_issues_count (issues plus PRs) is never used for the issues stat", async () => {
  const stats = await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch({
      repo: json({ stargazers_count: 1, forks_count: 1, open_issues_count: 99 }),
      issues: json({}),
      hub: json({}),
    }),
  });
  assert.equal(stats.openIssues, undefined);
});

test("a failing source is omitted and the others still come back", async () => {
  const stats = await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch({
      repo: json({ message: "rate limited" }, 403),
      issues: () => {
        throw new Error("network down");
      },
      hub: json({ pull_count: 10 }),
    }),
  });
  assert.deepEqual(stats, { downloads: 10 });
});

test("every source failing gives an empty result instead of throwing", async () => {
  const boom = () => {
    throw new Error("offline");
  };
  const stats = await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch({ repo: boom, issues: boom, hub: boom }),
  });
  assert.deepEqual(stats, {});
});

test("unusable payloads are dropped, not rendered", async () => {
  const stats = await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch({
      repo: json({ stargazers_count: "273", forks_count: -2 }),
      issues: json({ total_count: 1.5 }),
      hub: json(null),
    }),
  });
  assert.deepEqual(stats, {});
});

test("the optional GitHub credential goes to GitHub only, never Docker Hub", async () => {
  const calls = [];
  await fetchLiveStats(SOURCE, {
    auth: "secret-value",
    fetchImpl: fakeFetch({ repo: json({}), issues: json({}), hub: json({}) }, calls),
  });
  for (const { url, init } of calls) {
    const sent = init.headers.Authorization;
    if (url.startsWith("https://api.github.com/")) assert.equal(sent, "Bearer secret-value");
    else assert.equal(sent, undefined);
  }
  const anon = [];
  await fetchLiveStats(SOURCE, {
    fetchImpl: fakeFetch({ repo: json({}), issues: json({}), hub: json({}) }, anon),
  });
  assert.ok(anon.every(({ init }) => init.headers.Authorization === undefined));
});

test("the credential env var is server-only and the stats code never runs in the browser", () => {
  assert.match(proofSource, /process\.env\.GITHUB_STATS_AUTH/);
  assert.doesNotMatch(proofSource, /NEXT_PUBLIC_[A-Z_]*(AUTH|GITHUB)/);
  assert.doesNotMatch(proofSource, /^"use client"/m);
  assert.doesNotMatch(statsSource, /^"use client"/m);
  assert.doesNotMatch(statsSource, /process\.env/);
});

test("no star, fork, download or issue count is hard-coded in the proof band or the helper", () => {
  const rendered = proofSource.match(/<b>[^<]*<\/b>[^<]*/g) ?? [];
  const literals = rendered.filter((chunk) => /stars|forks|downloads|issues/i.test(chunk));
  assert.deepEqual(literals, [], "live stats must render from fetched values only");
  assert.doesNotMatch(statsSource, /(?:stars|forks|downloads|openIssues)\s*[:=]\s*\d/);
  assert.match(proofSource, /formatCount\(stat\.value\)/);
  assert.match(proofSource, /filter\(\(stat\)[^)]*stat\.value !== undefined/);
});

test("each live stat links to its source and the static MIT stat is gone", () => {
  assert.match(proofSource, /\/stargazers/);
  assert.match(proofSource, /DOCKER_HUB_URL/);
  assert.match(proofSource, /\/forks/);
  assert.match(proofSource, /\/issues/);
  assert.doesNotMatch(proofSource, /<b>MIT<\/b>/);
});
