import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sitemapSource = readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");

test("sitemap route avoids runtime filesystem tracing", () => {
  assert.doesNotMatch(sitemapSource, /from ["']node:fs["']/);
  assert.doesNotMatch(sitemapSource, /from ["']node:path["']/);
  assert.doesNotMatch(sitemapSource, /\bprocess\.cwd\(\)/);
  assert.doesNotMatch(sitemapSource, /\bstatSync\(/);
});
