import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";

test("next config enables SRI for frontend bundles", () => {
  assert.equal(nextConfig.experimental?.sri?.algorithm, "sha256");
});

test("production build uses Turbopack without --webpack", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const buildScript = packageJson.scripts?.build ?? "";

  assert.match(buildScript, /\bnext build\b/, "build script should run next build");
  assert.doesNotMatch(buildScript, /--webpack\b/, "Turbopack build must not pass --webpack");
  assert.ok(
    nextConfig.experimental?.sri?.algorithm,
    "experimental.sri must be configured so Turbopack emits integrity hashes natively",
  );
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
