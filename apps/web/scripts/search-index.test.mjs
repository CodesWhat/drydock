import assert from "node:assert/strict";
import { test } from "node:test";

import { initAdvancedSearch } from "fumadocs-core/search/server";

import { buildDocsSearchIndex } from "../src/lib/search-index.ts";

test("buildDocsSearchIndex tags the index with the page's version slug", () => {
  const structuredData = { headings: [], contents: [] };
  const page = {
    url: "/docs/v1.7/changelog",
    slugs: ["v1.7", "changelog"],
    path: "changelog.mdx",
    data: {
      title: "Changelog",
      description: "All notable changes to this project.",
      structuredData,
    },
  };

  const index = buildDocsSearchIndex(page);

  assert.equal(index.tag, "v1.7");
  assert.equal(index.url, "/docs/v1.7/changelog");
  assert.equal(index.id, "/docs/v1.7/changelog");
  assert.equal(index.title, "Changelog");
  assert.equal(index.description, "All notable changes to this project.");
  assert.deepEqual(index.structuredData, structuredData);
});

test("buildDocsSearchIndex falls back to the filename when a page has no title", () => {
  const page = {
    url: "/docs/v1.6/faq",
    slugs: ["v1.6", "faq"],
    path: "faq/index.mdx",
    data: {
      title: undefined,
      structuredData: { headings: [], contents: [] },
    },
  };

  const index = buildDocsSearchIndex(page);

  assert.equal(index.title, "index");
  assert.equal(index.tag, "v1.6");
});

// Regression pin for the production defect: /api/search?query=trigger
// returned 1579 results spanning every archived docs version at once, with
// the frozen v1.4 changelog outranking the current v1.7 docs. Tagging each
// index entry by version (buildDocsSearchIndex, above) is what makes a
// tag-filtered query actually exclude other versions — this exercises the
// real fumadocs-core search engine our /api/search route runs on to prove
// that mechanism, not just that we set a `tag` field.
test("a tag-filtered search excludes pages from other docs versions", async () => {
  const term = "removed the legacy trigger prefix";
  const makeIndex = (version) => ({
    id: `/docs/${version}/changelog`,
    url: `/docs/${version}/changelog`,
    title: `${version} changelog`,
    tag: version,
    structuredData: {
      headings: [],
      contents: [{ heading: undefined, content: term }],
    },
  });

  const server = initAdvancedSearch({
    indexes: [makeIndex("v1.4"), makeIndex("v1.5"), makeIndex("v1.6"), makeIndex("v1.7")],
  });

  const unfiltered = await server.search("trigger");
  assert.ok(
    unfiltered.some((r) => r.url === "/docs/v1.4/changelog"),
    "sanity check: the term must be findable in the older version before filtering",
  );
  assert.ok(
    unfiltered.some((r) => r.url === "/docs/v1.7/changelog"),
    "sanity check: the term must be findable in the current version before filtering",
  );

  const filtered = await server.search("trigger", { tag: "v1.7" });
  assert.ok(filtered.length > 0, "the requested version's own match must still be returned");
  for (const result of filtered) {
    assert.equal(
      result.url,
      "/docs/v1.7/changelog",
      `expected only v1.7 results, got a result from ${result.url}`,
    );
  }
});
