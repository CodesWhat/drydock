import assert from "node:assert/strict";
import { test } from "node:test";

import { currentDocsVersionSlug, docsSearchTagForPathname } from "../src/lib/docs-search-tag.ts";
import { versions } from "./docs-versions.mjs";

test("current version slug matches the first entry in the version list", () => {
  assert.equal(currentDocsVersionSlug, versions[0].slug);
});

test("a docs page scopes search to its own version segment", () => {
  for (const v of versions) {
    assert.equal(docsSearchTagForPathname(`/docs/${v.slug}/changelog`), v.slug);
    assert.equal(docsSearchTagForPathname(`/docs/${v.slug}`), v.slug);
  }
});

test("a non-docs page defaults to the current version, not a version picker", () => {
  assert.equal(docsSearchTagForPathname("/"), currentDocsVersionSlug);
  assert.equal(docsSearchTagForPathname("/compare"), currentDocsVersionSlug);
});

test("an unrecognized version segment falls back to the current version", () => {
  assert.equal(docsSearchTagForPathname("/docs/v0.9/changelog"), currentDocsVersionSlug);
  assert.equal(docsSearchTagForPathname("/docs"), currentDocsVersionSlug);
});
