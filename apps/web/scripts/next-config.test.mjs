import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";

// experimental.sri must stay OFF. Next emits integrity hashes that don't match
// the bytes Vercel actually serves (Turbopack chunks plus post-build
// compression), so the browser blocks every script and the site never hydrates:
// homepage reveal sections stay invisible and the docs nav goes dead. It was
// removed in #236 for this exact reason and re-added by mistake in v1.5.1-rc.1
// (#454). The CSP in vercel.json is the real script hardening.
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

  const rootRedirect = redirects.find((rule) => rule.source === "/docs");
  assert.deepEqual(rootRedirect, {
    source: "/docs",
    destination: "/docs/v1.5",
    permanent: false,
  });

  assert.ok(
    redirects.some(
      (rule) =>
        rule.source === "/docs/:path((?!v1\\.5(?:/|$)|v1\\.4(?:/|$)|v1\\.3(?:/|$)).*)" &&
        rule.destination === "/docs/v1.5/:path" &&
        rule.permanent === false,
    ),
    "expected a deep-link compatibility redirect for unversioned docs paths",
  );
});
