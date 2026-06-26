import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import nextConfig from "../next.config.mjs";
import { versions } from "./docs-versions.mjs";

// Mirror the repoRoot logic from sync-docs.mjs:
// scriptDir = apps/web/scripts/, webRoot = apps/web/, repoRoot = repo root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const repoRoot = join(webRoot, "..", "..");

test("versions list is non-empty and every entry has a slug", () => {
  assert.ok(versions.length > 0, "versions must be non-empty");
  for (const v of versions) {
    assert.ok(v.slug, `version entry must have a slug: ${JSON.stringify(v)}`);
    assert.ok(v.source, `version entry must have a source: ${JSON.stringify(v)}`);
  }
});

test("every version source directory exists under content/docs", () => {
  for (const v of versions) {
    const sourceDir = join(repoRoot, "content", "docs", v.source);
    assert.ok(
      existsSync(sourceDir),
      `docs source directory must exist: content/docs/${v.source} (version ${v.slug})`,
    );
  }
});

test("root /docs redirect points to the first (current) version slug", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const rootRedirect = redirects.find((r) => r.source === "/docs");

  assert.ok(rootRedirect, "root /docs redirect must exist");
  assert.equal(
    rootRedirect.destination,
    `/docs/${versions[0].slug}`,
    `root redirect should point to first version: ${versions[0].slug}`,
  );
  assert.equal(rootRedirect.permanent, false);
});

test("deep-link compatibility redirect covers every version slug", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const deepRedirect = redirects.find((r) => r.source.startsWith("/docs/:path("));

  assert.ok(deepRedirect, "deep-link compatibility redirect must exist");

  for (const v of versions) {
    // Each slug "v1.5" must appear escaped as "v1\.5" in the negative lookahead pattern
    const escapedSlug = v.slug.replace(/\./g, "\\.");
    assert.ok(
      deepRedirect.source.includes(escapedSlug),
      `redirect pattern should include version ${v.slug} (escaped: ${escapedSlug})`,
    );
  }
});

test("deep-link redirect destination uses the current version slug", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const deepRedirect = redirects.find((r) => r.source.startsWith("/docs/:path("));

  assert.ok(deepRedirect, "deep-link compatibility redirect must exist");
  assert.equal(
    deepRedirect.destination,
    `/docs/${versions[0].slug}/:path`,
    `deep redirect should forward to current version: ${versions[0].slug}`,
  );
  assert.equal(deepRedirect.permanent, false);
});
