import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8");

test("robots keeps the catch-all allow and names the AI search crawlers explicitly", () => {
  assert.match(source, /userAgent: "\*", allow: "\/"/);
  for (const agent of [
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Claude-SearchBot",
    "Claude-User",
  ]) {
    assert.match(source, new RegExp(`"${agent}"`));
  }
  assert.match(source, /allow: "\/"/);
});

test("robots does not block any training crawler or the whole site", () => {
  assert.doesNotMatch(source, /GPTBot|CCBot|Google-Extended|ClaudeBot|Bytespider/);
  assert.doesNotMatch(source, /disallow: "\/"|disallow: \["\/"\]/);
});

test("robots still advertises the sitemap", () => {
  assert.match(source, /sitemap: `\$\{BASE_URL\}\/sitemap\.xml`/);
});

test("robots disallows every superseded docs version but never the current one", async () => {
  const { versions } = await import("./docs-versions.mjs");
  assert.match(source, /versions\.slice\(1\)/);
  assert.match(source, /\/docs\/\$\{v\.slug\}\//);
  assert.doesNotMatch(source, /versions\[0\]/);
  assert.ok(versions.length > 1);
});
