import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rewriteChangelogLinksForVersion,
  rewriteDocsLinksForVersion,
} from "./docs-link-rewriter.mjs";

test("rewriteDocsLinksForVersion scopes docs links to the generated version", () => {
  const input = [
    "[Quick Start](/docs/quickstart)",
    "[Config](/docs/configuration/watchers#labels)",
    '<a href="/docs/api">API</a>',
    '<img src="/docs/assets/logo.png" />',
    "[Already versioned](/docs/v1.4/api)",
  ].join("\n");

  assert.equal(
    rewriteDocsLinksForVersion(input, "v1.3"),
    [
      "[Quick Start](/docs/v1.3/quickstart)",
      "[Config](/docs/v1.3/configuration/watchers#labels)",
      '<a href="/docs/v1.3/api">API</a>',
      '<img src="/docs/assets/logo.png" />',
      "[Already versioned](/docs/v1.4/api)",
    ].join("\n"),
  );
});

test("rewriteDocsLinksForVersion handles docs root and hash links", () => {
  assert.equal(rewriteDocsLinksForVersion("[Docs](/docs)", "v1.5"), "[Docs](/docs/v1.5)");
  assert.equal(
    rewriteDocsLinksForVersion("[Anchor](/docs#overview)", "v1.5"),
    "[Anchor](/docs/v1.5#overview)",
  );
});

test("rewriteChangelogLinksForVersion points deprecation links at the docs page", () => {
  assert.equal(
    rewriteChangelogLinksForVersion(
      [
        "See `DEPRECATIONS.md` for the full schedule.",
        "See [DEPRECATIONS.md](./DEPRECATIONS.md) for migration guidance.",
      ].join("\n"),
      "v1.5",
    ),
    [
      "See [deprecations](/docs/v1.5/deprecations) for the full schedule.",
      "See [DEPRECATIONS.md](/docs/v1.5/deprecations) for migration guidance.",
    ].join("\n"),
  );
});
