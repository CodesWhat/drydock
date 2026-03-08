import assert from "node:assert/strict";
import { test } from "node:test";

import { isFaqSlug } from "./docs-faq-route.ts";

test("isFaqSlug matches the unversioned FAQ route", () => {
  assert.equal(isFaqSlug(["faq"]), true);
});

test("isFaqSlug matches the versioned FAQ route", () => {
  assert.equal(isFaqSlug(["v1.4", "faq"]), true);
});

test("isFaqSlug rejects non-FAQ routes", () => {
  assert.equal(isFaqSlug(["v1.4", "getting-started"]), false);
  assert.equal(isFaqSlug(undefined), false);
});
