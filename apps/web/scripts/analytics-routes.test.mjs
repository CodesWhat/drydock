import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { collectAnalyticsRoutes, renderAnalyticsRouteManifest } from "./analytics-routes.mjs";

const webRoot = new URL("..", import.meta.url);
const repoRoot = new URL("../../..", import.meta.url);
const generatedUrl = new URL("../src/lib/analytics-routes.generated.ts", import.meta.url);

test("route manifest covers every finite marketing, comparison, security, and versioned docs page", () => {
  const routes = collectAnalyticsRoutes({ webRoot, repoRoot });

  for (const route of [
    "/",
    "/compare",
    "/compare/portainer",
    "/security/trivy-supply-chain-march-2026",
    "/docs/v1.7",
    "/docs/v1.7/guides/security",
    "/docs/v1.7/changelog",
    "/docs/v1.3",
    "/docs/v1.3/quickstart/cosign",
  ]) {
    assert.equal(routes.includes(route), true, `missing analytics route ${route}`);
  }

  assert.equal(
    routes.some((route) => route.startsWith("/api/")),
    false,
  );
  assert.equal(
    routes.some((route) => route.includes("[")),
    false,
  );
  assert.equal(new Set(routes).size, routes.length);
  assert.deepEqual(routes, [...routes].sort());
});

test("checked-in analytics route manifest exactly matches route and docs sources", () => {
  const routes = collectAnalyticsRoutes({ webRoot, repoRoot });

  assert.equal(readFileSync(generatedUrl, "utf8"), renderAnalyticsRouteManifest(routes));
});
