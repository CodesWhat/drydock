import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rewriteChangelogLinksForVersion,
  rewriteDocsFileForVersion,
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

test("rewriteDocsLinksForVersion leaves bare /docs/assets unchanged", () => {
  assert.equal(
    rewriteDocsLinksForVersion("[Assets](/docs/assets)", "v1.5"),
    "[Assets](/docs/assets)",
  );
});

test("rewriteDocsLinksForVersion handles single-quoted HTML attributes", () => {
  assert.equal(
    rewriteDocsLinksForVersion("<a href='/docs/api'>API</a>", "v1.5"),
    "<a href='/docs/v1.5/api'>API</a>",
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

test("rewriteDocsFileForVersion fixes relative DEPRECATIONS.md links in a changelog file", () => {
  const input = "See [DEPRECATIONS.md](./DEPRECATIONS.md) for migration guidance.";
  assert.equal(
    rewriteDocsFileForVersion("changelog/index.mdx", input, "v1.5"),
    "See [DEPRECATIONS.md](/docs/v1.5/deprecations) for migration guidance.",
  );
});

test("rewriteDocsFileForVersion leaves a relative DEPRECATIONS.md mention alone outside changelog files", () => {
  // Only content/docs/<version>/changelog/index.mdx is a frozen copy of the
  // root CHANGELOG.md's relative links -- an unrelated doc page mentioning
  // DEPRECATIONS.md this way isn't the pattern being fixed here.
  const input = "See [DEPRECATIONS.md](./DEPRECATIONS.md) for migration guidance.";
  assert.equal(rewriteDocsFileForVersion("configuration/index.mdx", input, "v1.5"), input);
});

test("rewriteDocsFileForVersion recognises a backslash-separated changelog path", () => {
  // sync-docs builds the relative path with node:path.relative, which emits
  // the host separator, so on Windows this arrives backslash-separated. The
  // changelog rewrite has to fire there too, not silently skip.
  const input = "See [DEPRECATIONS.md](./DEPRECATIONS.md) for migration guidance.";
  assert.equal(
    rewriteDocsFileForVersion("changelog\\index.mdx", input, "v1.5"),
    "See [DEPRECATIONS.md](/docs/v1.5/deprecations) for migration guidance.",
  );
});

test("rewriteDocsFileForVersion still rewrites absolute /docs links in a changelog file", () => {
  const input = "[Quick Start](/docs/quickstart)";
  assert.equal(
    rewriteDocsFileForVersion("changelog/index.mdx", input, "v1.5"),
    "[Quick Start](/docs/v1.5/quickstart)",
  );
});
