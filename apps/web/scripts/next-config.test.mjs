import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";

test("next config enables SRI for frontend bundles", () => {
  assert.equal(nextConfig.experimental?.sri?.algorithm, "sha384");
});

test("production build uses webpack so SRI is applied", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.scripts?.build ?? "", /\bnext build\b[\s\S]*--webpack\b/);
  assert.match(packageJson.scripts?.build ?? "", /\bnode\s+scripts\/apply-sri\.mjs\b/);
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
