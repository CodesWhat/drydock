import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";
import { escapeRegExp, versions } from "./docs-versions.mjs";

// experimental.sri must stay OFF. Turbopack DID gain SRI support in Next 16.2,
// so "the bundler supports it now" is not a reason to turn it back on: the hash
// is computed at build time on the raw chunk, but Vercel's edge re-encodes the
// bytes (brotli/gzip), so the integrity attribute never matches what the browser
// receives and every script gets blocked. Nothing hydrates: homepage reveal
// sections stay invisible and the docs nav goes dead. Open upstream bug:
// vercel/next.js#91633. Removed in #236, re-added by mistake in v1.5.1-rc.1
// (#454). Only safe to re-enable once #91633 ships a fix. The request-scoped
// nonce CSP in src/proxy.ts is the script hardening.
test("next config does not enable experimental SRI (it blocks hydration)", () => {
  assert.equal(nextConfig.experimental?.sri, undefined);
});

test("production build uses Turbopack without --webpack", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const buildScript = packageJson.scripts?.build ?? "";

  assert.match(buildScript, /\bnext build\b/, "build script should run next build");
  assert.doesNotMatch(buildScript, /--webpack\b/, "Turbopack build must not pass --webpack");
});

test("docs redirects keep versioned URLs and map legacy deep links to current docs", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const currentVersion = versions[0].slug;
  const versionPrefixPattern = versions.map((v) => `${escapeRegExp(v.slug)}(?:/|$)`).join("|");

  const rootRedirect = redirects.find((rule) => rule.source === "/docs");
  assert.deepEqual(rootRedirect, {
    source: "/docs",
    destination: `/docs/${currentVersion}`,
    permanent: false,
  });

  assert.ok(
    redirects.some(
      (rule) =>
        rule.source === `/docs/:path((?!assets(?:/|$)|${versionPrefixPattern}).*)` &&
        rule.destination === `/docs/${currentVersion}/:path` &&
        rule.permanent === false,
    ),
    "expected a deep-link compatibility redirect that excludes static docs assets",
  );
});
