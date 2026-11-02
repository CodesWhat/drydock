import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildLlmsTxt } from "../src/lib/llms-txt.ts";
import * as siteConfig from "../src/lib/site-config.ts";
import { versions } from "./docs-versions.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("DOCS_ROOT is derived from the first docs version", () => {
  assert.equal(siteConfig.DOCS_ROOT, `/docs/${versions[0].slug}`);
});

test("sitemap lists only current docs and omits request-time lastmod", () => {
  const source = read("../src/app/sitemap.ts");
  assert.match(source, /DOCS_ROOT/);
  assert.match(source, /\.filter\(/);
  assert.doesNotMatch(source, /new Date\(\)/);
  assert.doesNotMatch(source, /changeFrequency|priority/);
});

test("nav, footer and CTA docs links go straight to DOCS_ROOT", () => {
  for (const file of ["header-nav", "footer", "mobile-navigation", "cta-buttons", "get-started"]) {
    const source = read(`../src/components/${file}.tsx`);
    assert.doesNotMatch(source, /["'`]\/docs["'`/]/, `${file} must not link to bare /docs`);
    assert.match(source, /DOCS_ROOT/, `${file} must use DOCS_ROOT`);
  }
  assert.doesNotMatch(read("../src/app/not-found.tsx"), /href="\/docs"/);
});

test("the /docs/current redirect stays temporary", async () => {
  const { default: nextConfig } = await import("../next.config.mjs");
  const redirects = await nextConfig.redirects();
  const current = redirects.find((r) => r.source === "/docs/current/:path*");
  assert.equal(current?.permanent, false);
});

test("docs metadata carries social images and a branded og title", () => {
  const source = read("../src/app/docs/[[...slug]]/page.tsx");
  const openGraph = source.match(/openGraph: \{[\s\S]*?\n {4}\},/)?.[0] ?? "";
  const twitter = source.match(/twitter: \{[\s\S]*?\n {4}\},/)?.[0] ?? "";
  assert.match(openGraph, /images:/);
  assert.match(twitter, /images:/);
  assert.match(source, /Drydock Documentation \| Docker Container Update Monitor/);
});

test("the 404 page leaves robots to Next so only one tag renders", () => {
  assert.doesNotMatch(read("../src/app/not-found.tsx"), /^\s*robots:/m);
});

test("site title and description carry the search phrase and the README counts", () => {
  assert.match(siteConfig.SITE_CONFIG.title, /Docker/);
  assert.match(siteConfig.SITE_CONFIG.title, /Self-Hosted/);
  assert.match(siteConfig.SITE_CONFIG.description, /Docker/);
  assert.match(siteConfig.SITE_CONFIG.description, /23 registries/);
  assert.match(siteConfig.SITE_CONFIG.description, /21 triggers/);
  assert.ok(siteConfig.SITE_CONFIG.description.length <= 160);
  const page = read("../src/app/page.tsx");
  assert.match(page, /description: SITE_CONFIG\.description/);
  assert.doesNotMatch(page, /built in TypeScript/);
});

test("llms.txt is built in llmstxt.org shape from resolved links", () => {
  const text = buildLlmsTxt({
    name: "Drydock",
    description: "A description.",
    docs: [{ title: "Docs", url: "https://example.test/docs/v1.8" }],
    comparisons: [],
    project: [{ title: "GitHub", url: "https://github.com/x/y", note: "source" }],
  });
  assert.equal(
    text,
    [
      "# Drydock",
      "",
      "> A description.",
      "",
      "## Docs",
      "",
      "- [Docs](https://example.test/docs/v1.8)",
      "",
      "## Project",
      "",
      "- [GitHub](https://github.com/x/y): source",
      "",
    ].join("\n"),
  );
});

test("llms.txt route is static text/plain and reads the current docs tree", () => {
  const source = read("../src/app/llms.txt/route.ts");
  assert.match(source, /text\/plain/);
  assert.match(source, /force-static/);
  assert.match(source, /DOCS_VERSION/);
});

test("hero shows stable first and links the RC to its migration warning", () => {
  const hero = read("../src/components/hero.tsx");
  assert.match(hero, /SITE_CONFIG\.stableVersion/);
  assert.match(hero, /stable/);
  assert.match(hero, /available to test/);
  assert.match(hero, /upgrade-from-json/);
  assert.doesNotMatch(hero, /SITE_CONFIG\.version\}/);
  assert.match(siteConfig.SITE_CONFIG.version, /rc/);
});

test("homepage comparison marks Watchtower distributed agents partial, like the detail page", () => {
  const source = read("../src/components/compare-section.tsx");
  assert.match(source, /label: "Distributed agents",\s*drydock: "yes",\s*watchtower: "partial"/);
});

test("roadmap does not claim static-image monitoring shipped and matches the README rows", async () => {
  const { roadmap } = await import("../src/lib/site-content.ts");
  const v17 = roadmap.find((m) => m.version === "v1.7.0");
  assert.doesNotMatch(v17.items.join(" "), /static-image|Image cleanup/i);
  assert.ok(roadmap.some((m) => m.version === "v1.9.0" && m.status === "planned"));
  assert.ok(roadmap.some((m) => m.version === "v2.0+"));
  for (const gone of ["v2.1.0", "v2.2.0", "v2.3.0", "v2.4.0", "v3.0.0", "v3.1.0"]) {
    assert.ok(!roadmap.some((m) => m.version === gone), `${gone} is collapsed into v2.0+`);
  }
});

test("get-started says what the quick start turns off", () => {
  const source = read("../src/components/get-started.tsx");
  assert.match(source, /DD_ANONYMOUS_AUTH_CONFIRM=true/);
  assert.doesNotMatch(source, /Get started in seconds/);
});

test("watchtower page title and lead say alternative and name the fork", () => {
  const source = read("../src/lib/comparison-route-data/watchtower.tsx");
  assert.match(source, /metadataTitle: "Watchtower Alternative/);
  assert.match(source, /heroTitle: "Watchtower alternative/);
  assert.match(source, /nicholas-fedor\/watchtower/);
  assert.match(source, /v1\.7\.1/);
});
