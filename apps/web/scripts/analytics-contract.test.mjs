import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalizePathname,
  createBeforeSend,
  getAnalyticsConfig,
  getSurface,
  isAllowedCta,
  POSTHOG_API_HOST,
  POSTHOG_UI_HOST,
  PRODUCTION_ORIGIN,
} from "../src/lib/analytics-contract.ts";

const ROUTES = new Set(["/", "/compare", "/docs/v1.7", "/docs/v1.7/guides/security"]);
const APPROVED_CTA_TUPLES = [
  ["marketing", "docs_root", "header"],
  ["marketing", "github_repository", "header"],
  ["docs", "docs_root", "header"],
  ["docs", "github_repository", "header"],
  ["marketing", "docs_root", "hero"],
  ["marketing", "github_repository", "hero"],
  ["marketing", "docs_root", "comparison"],
  ["marketing", "github_repository", "comparison"],
  ["marketing", "install_quick", "get_started"],
  ["marketing", "install_secure", "get_started"],
  ["marketing", "docs_security", "get_started"],
  ["marketing", "docs_root", "footer"],
  ["marketing", "github_repository", "footer"],
  ["marketing", "community_discord", "footer"],
  ["docs", "docs_root", "footer"],
  ["docs", "github_repository", "footer"],
  ["docs", "community_discord", "footer"],
  ["marketing", "github_repository", "star_history"],
];

test("analytics requires the complete exact public environment contract", () => {
  assert.deepEqual(
    getAnalyticsConfig({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public-token_123",
      NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_API_HOST,
      NEXT_PUBLIC_POSTHOG_UI_HOST: POSTHOG_UI_HOST,
    }),
    {
      token: "phc_public-token_123",
      apiHost: POSTHOG_API_HOST,
      uiHost: POSTHOG_UI_HOST,
    },
  );

  for (const env of [
    {},
    { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public-token_123" },
    {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "public-token",
      NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_API_HOST,
      NEXT_PUBLIC_POSTHOG_UI_HOST: POSTHOG_UI_HOST,
    },
    {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public-token_123",
      NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
      NEXT_PUBLIC_POSTHOG_UI_HOST: POSTHOG_UI_HOST,
    },
    {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public-token_123",
      NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_API_HOST,
      NEXT_PUBLIC_POSTHOG_UI_HOST: "https://eu.posthog.com",
    },
  ]) {
    assert.equal(getAnalyticsConfig(env), null);
  }
});

test("canonical paths never retain hostile URL data or unknown path text", () => {
  assert.equal(canonicalizePathname("/", ROUTES), "/");
  assert.equal(canonicalizePathname("/compare/", ROUTES), "/compare");
  assert.equal(canonicalizePathname("/compare/?utm_source=secret#secret", ROUTES), "/compare");
  assert.equal(canonicalizePathname("/private/decoded-secret", ROUTES), "/_other");
  assert.equal(canonicalizePathname("/%64ocs/v1.7", ROUTES), "/_other");
  assert.equal(canonicalizePathname("https://evil.example/compare", ROUTES), "/_other");
  assert.equal(canonicalizePathname(undefined, ROUTES), "/_other");

  assert.equal(getSurface("/docs"), "docs");
  assert.equal(getSurface("/docs/v1.7"), "docs");
  assert.equal(getSurface("/docs-secret"), "marketing");
  assert.equal(getSurface("/"), "marketing");
});

test("CTA tuples are finite and surface-aware", () => {
  assert.equal(isAllowedCta("marketing", "github_repository", "hero"), true);
  assert.equal(isAllowedCta("marketing", "install_secure", "get_started"), true);
  assert.equal(isAllowedCta("docs", "community_discord", "footer"), true);
  assert.equal(isAllowedCta("docs", "github_repository", "hero"), false);
  assert.equal(isAllowedCta("marketing", "live_demo", "hero"), false);
  assert.equal(isAllowedCta("marketing", "github_repository", "unknown"), false);
});

test("CTA allowlist exactly covers every approved site combination", () => {
  const surfaces = ["marketing", "docs"];
  const ctaIds = [
    "docs_root",
    "github_repository",
    "community_discord",
    "install_quick",
    "install_secure",
    "docs_security",
  ];
  const placements = ["header", "hero", "comparison", "get_started", "footer", "star_history"];
  const actual = surfaces.flatMap((surface) =>
    ctaIds.flatMap((ctaId) =>
      placements
        .filter((placement) => isAllowedCta(surface, ctaId, placement))
        .map((placement) => `${surface}\0${ctaId}\0${placement}`),
    ),
  );
  const expected = APPROVED_CTA_TUPLES.map((tuple) => tuple.join("\0"));

  assert.deepEqual(actual.sort(), expected.sort());
});

test("pageviews are rebuilt from the canonical production URL and a minimal envelope", () => {
  const timestamp = new Date("2026-08-14T12:00:00.000Z");
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const result = beforeSend({
    uuid: "018f0000-0000-7000-8000-000000000001",
    event: "$pageview",
    timestamp,
    $set: { email: "secret@example.com" },
    properties: {
      token: "attacker-token",
      distinct_id: "$posthog_cookieless",
      $cookieless_mode: true,
      $process_person_profile: false,
      path: "/compare/?utm_source=secret#secret",
      surface: "docs",
      title: "Private title",
      $referrer: "https://secret.example",
      $set: { plan: "secret" },
    },
  });

  assert.deepEqual(result, {
    uuid: "018f0000-0000-7000-8000-000000000001",
    event: "$pageview",
    timestamp,
    properties: {
      token: "phc_public-token_123",
      distinct_id: "$posthog_cookieless",
      $cookieless_mode: true,
      $process_person_profile: false,
      schema_version: 1,
      site: "drydock",
      surface: "marketing",
      path: "/compare",
      $current_url: `${PRODUCTION_ORIGIN}/compare`,
    },
  });
});

test("CTA events require an allowlisted tuple and retain no extra properties", () => {
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const base = {
    uuid: "018f0000-0000-7000-8000-000000000002",
    event: "cta activated",
    properties: {
      path: "/docs/v1.7/guides/security",
      cta_id: "github_repository",
      placement: "footer",
      element_text: "secret",
    },
  };

  assert.deepEqual(beforeSend(base), {
    uuid: base.uuid,
    event: "cta activated",
    properties: {
      token: "phc_public-token_123",
      schema_version: 1,
      site: "drydock",
      surface: "docs",
      path: "/docs/v1.7/guides/security",
      cta_id: "github_repository",
      placement: "footer",
    },
  });
  assert.equal(
    beforeSend({
      ...base,
      properties: { ...base.properties, cta_id: "live_demo", placement: "hero" },
    }),
    null,
  );
});

test("web vitals keep only finite nonnegative allowlisted metric values", () => {
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const result = beforeSend({
    uuid: "018f0000-0000-7000-8000-000000000003",
    event: "$web_vitals",
    properties: {
      $current_url: `${PRODUCTION_ORIGIN}/docs/v1.7?secret=yes#private`,
      $web_vitals_CLS_value: 0.01,
      $web_vitals_FCP_value: 123.4,
      $web_vitals_INP_value: -1,
      $web_vitals_LCP_value: Number.POSITIVE_INFINITY,
      $web_vitals_TTFB_value: 2,
      $web_vitals_LCP_event: { navigationEntry: "secret" },
    },
  });

  assert.deepEqual(result, {
    uuid: "018f0000-0000-7000-8000-000000000003",
    event: "$web_vitals",
    properties: {
      token: "phc_public-token_123",
      schema_version: 1,
      site: "drydock",
      surface: "docs",
      path: "/docs/v1.7",
      $web_vitals_CLS_value: 0.01,
      $web_vitals_FCP_value: 123.4,
    },
  });
  assert.equal(
    beforeSend({
      uuid: "018f0000-0000-7000-8000-000000000004",
      event: "$web_vitals",
      properties: { $current_url: PRODUCTION_ORIGIN },
    }),
    null,
  );
});

test("unknown events and invalid capture results are dropped", () => {
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);

  assert.equal(beforeSend(null), null);
  assert.equal(beforeSend({ uuid: "018f", event: "$pageview", properties: null }), null);
  assert.equal(beforeSend({ uuid: "018f", event: "$pageview", properties: [] }), null);
  assert.equal(
    beforeSend({ uuid: "018f", event: "$autocapture", properties: { path: "/" } }),
    null,
  );
});
