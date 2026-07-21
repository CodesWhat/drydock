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
        rule.source === `/docs/:path((?!assets(?:/|$)|current(?:/|$)|${versionPrefixPattern}).*)` &&
        rule.destination === `/docs/${currentVersion}/:path` &&
        rule.permanent === false,
    ),
    "expected a deep-link compatibility redirect that excludes static docs assets and /docs/current",
  );
});

// Regression test for /docs/current/* 404s: "current" is not a real version
// slug (the current version's slug is e.g. "v1.6"), so without a dedicated
// rule the generic catch-all above swallowed "current" into :path and
// produced a broken double path like /docs/v1.6/current/getting-started.
test("docs/current/* redirects to the current version slug ahead of the generic catch-all", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  const currentVersion = versions[0].slug;

  const currentIndex = redirects.findIndex((rule) => rule.source === "/docs/current/:path*");
  const catchAllIndex = redirects.findIndex((rule) => rule.source.startsWith("/docs/:path("));

  assert.notEqual(currentIndex, -1, "expected a dedicated /docs/current/:path* redirect rule");
  assert.notEqual(catchAllIndex, -1, "expected the generic catch-all redirect rule");
  assert.ok(
    currentIndex < catchAllIndex,
    "the /docs/current/:path* redirect must precede the generic catch-all",
  );

  assert.deepEqual(redirects[currentIndex], {
    source: "/docs/current/:path*",
    destination: `/docs/${currentVersion}/:path*`,
    permanent: false,
  });
});
