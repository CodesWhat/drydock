import assert from "node:assert/strict";
import { test } from "node:test";

import * as analyticsContract from "../src/lib/analytics-contract.ts";
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
// posthog-js attaches these to every envelope by default. PostHog's
// cookieless server-hash ingestion reads them straight off event.properties
// and drops the event with a cookieless_missing_user_agent /
// cookieless_missing_host warning if either is absent, so before_send must
// require and forward them.
const COOKIELESS_HASH_PROPERTIES = {
  $raw_user_agent: "Mozilla/5.0 (Test Runner)",
  $host: "getdrydock.com",
};
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

test("CTA allowlist exactly matches the canonical exported tuple contract", () => {
  const canonicalTuples = analyticsContract.ANALYTICS_CTA_TUPLES;
  assert.ok(Array.isArray(canonicalTuples), "runtime must export its canonical CTA tuples");

  const surfaces = [...new Set(canonicalTuples.map(([surface]) => surface))];
  const ctaIds = [...new Set(canonicalTuples.map(([, ctaId]) => ctaId))];
  const placements = [...new Set(canonicalTuples.map(([, , placement]) => placement))];
  const actual = surfaces.flatMap((surface) =>
    ctaIds.flatMap((ctaId) =>
      placements
        .filter((placement) => isAllowedCta(surface, ctaId, placement))
        .map((placement) => `${surface}\0${ctaId}\0${placement}`),
    ),
  );
  const canonical = canonicalTuples.map((tuple) => tuple.join("\0"));
  const approved = APPROVED_CTA_TUPLES.map((tuple) => tuple.join("\0"));

  assert.deepEqual(canonical.sort(), approved.sort());
  assert.deepEqual(actual.sort(), canonical.sort());
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
      ...COOKIELESS_HASH_PROPERTIES,
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
      $pathname: "/compare",
      ...COOKIELESS_HASH_PROPERTIES,
    },
  });
});

test("pageleaves are rebuilt from posthog-js's own envelope onto the canonical contract", () => {
  // posthog-js emits $pageleave itself once capture_pageleave is true, so it
  // reaches before_send carrying PostHog's own properties ($current_url,
  // $raw_user_agent, $host, token, $cookieless_mode,
  // $process_person_profile) rather than ours. before_send has to rebuild it
  // from that envelope like any other event; before this branch existed the
  // fallthrough `return null` dropped every $pageleave silently, which is
  // why flipping capture_pageleave alone does nothing.
  const timestamp = new Date("2026-08-14T12:05:00.000Z");
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const result = beforeSend({
    uuid: "018f0000-0000-7000-8000-000000000008",
    event: "$pageleave",
    timestamp,
    properties: {
      ...COOKIELESS_HASH_PROPERTIES,
      $current_url: "https://getdrydock.com/compare/?utm_source=secret#secret",
      token: "phc_public-token_123",
      $cookieless_mode: true,
      $process_person_profile: false,
      $referrer: "https://secret.example",
      title: "Private title",
    },
  });

  assert.deepEqual(result, {
    uuid: "018f0000-0000-7000-8000-000000000008",
    event: "$pageleave",
    timestamp,
    properties: {
      token: "phc_public-token_123",
      $cookieless_mode: true,
      $process_person_profile: false,
      schema_version: 1,
      site: "drydock",
      surface: "marketing",
      path: "/compare",
      $current_url: `${PRODUCTION_ORIGIN}/compare`,
      $pathname: "/compare",
      ...COOKIELESS_HASH_PROPERTIES,
    },
  });
});

test("$pathname always equals the canonicalized path and never leaks an unlisted route", () => {
  // $pathname exists purely so PostHog's Web analytics Page / Entry page /
  // Exit page tables resolve at all; they read that property and nothing
  // else. It must stay bound to the already-canonicalized `path`: if it ever
  // carried the raw pathname instead, every unlisted route would start
  // leaking into the analytics project, which is exactly what the route
  // allowlist exists to prevent.
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  for (const event of ["$pageview", "$pageleave"]) {
    for (const rawPath of ["/", "/compare", "/private/customer-secret", "/docs/v1.7/unknown"]) {
      const result = beforeSend({
        uuid: "018f0000-0000-7000-8000-000000000009",
        event,
        properties: {
          ...COOKIELESS_HASH_PROPERTIES,
          path: rawPath,
          token: "phc_public-token_123",
        },
      });
      assert.ok(result, `${event} for ${rawPath} must not be dropped`);
      assert.equal(result.properties.$pathname, result.properties.path);
      assert.equal(
        String(result.properties.$pathname).includes("customer-secret"),
        false,
        `unlisted route leaked into $pathname for ${event} ${rawPath}`,
      );
    }
  }
});

test("before_send requires and forwards the cookieless server-hash fields", () => {
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const validProperties = {
    ...COOKIELESS_HASH_PROPERTIES,
    path: "/",
  };

  const result = beforeSend({
    uuid: "018f0000-0000-7000-8000-000000000005",
    event: "$pageview",
    properties: validProperties,
  });
  assert.ok(result);
  assert.equal(result.properties.$raw_user_agent, COOKIELESS_HASH_PROPERTIES.$raw_user_agent);
  assert.equal(result.properties.$host, COOKIELESS_HASH_PROPERTIES.$host);
  assert.equal("$ip" in result.properties, false);

  // Regression guard: if before_send ever goes back to rebuilding properties
  // from an allowlist that forgets these two keys, cookieless ingestion drops
  // every event again with zero warning-free indication beyond
  // cookieless_missing_user_agent / cookieless_missing_host.
  for (const missingKey of Object.keys(COOKIELESS_HASH_PROPERTIES)) {
    const withoutField = { ...validProperties };
    delete withoutField[missingKey];
    assert.equal(
      beforeSend({
        uuid: "018f0000-0000-7000-8000-000000000006",
        event: "$pageview",
        properties: withoutField,
      }),
      null,
      `before_send must drop events missing ${missingKey}`,
    );
  }

  for (const emptyKey of Object.keys(COOKIELESS_HASH_PROPERTIES)) {
    const withEmptyField = { ...validProperties, [emptyKey]: "" };
    assert.equal(
      beforeSend({
        uuid: "018f0000-0000-7000-8000-000000000007",
        event: "$pageview",
        properties: withEmptyField,
      }),
      null,
      `before_send must drop events with empty ${emptyKey}`,
    );
  }
});

test("CTA events require an allowlisted tuple and retain no extra properties", () => {
  const beforeSend = createBeforeSend("phc_public-token_123", ROUTES);
  const base = {
    uuid: "018f0000-0000-7000-8000-000000000002",
    event: "cta activated",
    properties: {
      ...COOKIELESS_HASH_PROPERTIES,
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
      ...COOKIELESS_HASH_PROPERTIES,
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
      ...COOKIELESS_HASH_PROPERTIES,
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
      ...COOKIELESS_HASH_PROPERTIES,
    },
  });
  assert.equal(
    beforeSend({
      uuid: "018f0000-0000-7000-8000-000000000004",
      event: "$web_vitals",
      properties: { ...COOKIELESS_HASH_PROPERTIES, $current_url: PRODUCTION_ORIGIN },
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
