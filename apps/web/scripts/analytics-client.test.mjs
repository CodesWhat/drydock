import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAnalyticsRuntime,
  createPostHogOptions,
  hasPrivacySignal,
  readPrivacySignal,
} from "../src/lib/analytics-client.ts";
import { POSTHOG_API_HOST, POSTHOG_UI_HOST } from "../src/lib/analytics-contract.ts";

const ROUTES = new Set(["/", "/compare", "/docs/v1.7"]);
const VALID_ENV = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public-token_123",
  NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_API_HOST,
  NEXT_PUBLIC_POSTHOG_UI_HOST: POSTHOG_UI_HOST,
};

test("PostHog options pin the privacy posture and cookieless web vitals", () => {
  const options = createPostHogOptions("phc_public-token_123", ROUTES);

  assert.deepEqual(
    { ...options, before_send: "function" },
    {
      api_host: POSTHOG_API_HOST,
      ui_host: POSTHOG_UI_HOST,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_web_experiments: true,
      advanced_disable_flags: true,
      person_profiles: "never",
      cookieless_mode: "always",
      persistence: "memory",
      disable_persistence: true,
      respect_dnt: true,
      save_referrer: true,
      save_campaign_params: false,
      disable_capture_url_hashes: true,
      disable_scroll_properties: true,
      mask_all_element_attributes: true,
      mask_all_text: true,
      capture_performance: {
        network_timing: false,
        web_vitals: true,
        web_vitals_allowed_metrics: ["CLS", "FCP", "INP", "LCP"],
        web_vitals_attribution: false,
      },
      before_send: "function",
    },
  );
  assert.equal("disable_external_dependency_loading" in options, false);
  assert.equal(typeof options.before_send, "function");
});

test("valid initialization queues until the SDK is ready and emits canonical events", async () => {
  const calls = [];
  let finishLoading;
  const posthog = {
    init(token, options) {
      calls.push(["init", token, options]);
    },
    capture(event, properties) {
      calls.push(["capture", event, properties]);
    },
  };
  const runtime = createAnalyticsRuntime({
    env: VALID_ENV,
    routes: ROUTES,
    hasPrivacySignal: () => false,
    loadPostHog: () =>
      new Promise((resolve) => {
        finishLoading = () => resolve(posthog);
      }),
  });

  const initialized = runtime.initialize();
  runtime.capturePageview("/compare/?utm_source=secret#secret");
  runtime.captureCta("/compare", "github_repository", "comparison");
  runtime.captureCta("/compare", "live_demo", "hero");
  assert.deepEqual(calls, []);

  finishLoading();
  await initialized;

  assert.equal(calls[0][0], "init");
  assert.equal(calls[0][1], "phc_public-token_123");
  assert.deepEqual(calls.slice(1), [
    [
      "capture",
      "$pageview",
      {
        path: "/compare",
        surface: "marketing",
        $current_url: "https://getdrydock.com/compare",
      },
    ],
    [
      "capture",
      "cta activated",
      {
        path: "/compare",
        surface: "marketing",
        cta_id: "github_repository",
        placement: "comparison",
      },
    ],
  ]);
});

test("missing, partial, malformed, and DNT environments never load or capture", async () => {
  for (const { env, dnt } of [
    { env: {}, dnt: false },
    { env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_partial" }, dnt: false },
    {
      env: {
        ...VALID_ENV,
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "private-token",
      },
      dnt: false,
    },
    { env: VALID_ENV, dnt: true },
  ]) {
    let loadCount = 0;
    const runtime = createAnalyticsRuntime({
      env,
      routes: ROUTES,
      hasPrivacySignal: () => dnt,
      loadPostHog: async () => {
        loadCount += 1;
        throw new Error("must not load");
      },
    });

    await runtime.initialize();
    runtime.capturePageview("/");
    runtime.captureCta("/", "github_repository", "hero");
    assert.equal(loadCount, 0);
  }
});

test("SDK load failures fail closed without leaking queued events", async () => {
  let loadCount = 0;
  const runtime = createAnalyticsRuntime({
    env: VALID_ENV,
    routes: ROUTES,
    hasPrivacySignal: () => false,
    loadPostHog: async () => {
      loadCount += 1;
      throw new Error("provider unavailable");
    },
  });

  const initialized = runtime.initialize();
  runtime.capturePageview("/");
  await assert.doesNotReject(initialized);
  runtime.capturePageview("/compare");
  assert.equal(loadCount, 1);
});

test("Do Not Track and Global Privacy Control are both detected", () => {
  assert.equal(hasPrivacySignal({ doNotTrack: "1" }), true);
  assert.equal(hasPrivacySignal({ globalPrivacyControl: true }), true);
  assert.equal(hasPrivacySignal({ msDoNotTrack: "1" }), true);
  assert.equal(hasPrivacySignal({}, { doNotTrack: "1" }), true);
  assert.equal(hasPrivacySignal({ doNotTrack: "0", globalPrivacyControl: false }), false);
  assert.equal(hasPrivacySignal({ doNotTrack: null }, {}), false);
  assert.equal(hasPrivacySignal(null, null), false);
});

test("reading the privacy signal is safe without navigator or window", () => {
  assert.equal(typeof navigator === "undefined" || typeof window === "undefined", true);
  assert.equal(readPrivacySignal(), false);
});

test("before_send drops every event once a privacy signal is set", () => {
  let signal = false;
  const options = createPostHogOptions("phc_public-token_123", ROUTES, () => signal);
  const event = {
    uuid: "u",
    event: "$pageview",
    properties: { $raw_user_agent: "UA", $host: "getdrydock.com", $pathname: "/" },
  };
  assert.notEqual(options.before_send(structuredClone(event)), null);
  signal = true;
  assert.equal(options.before_send(structuredClone(event)), null);
});

test("a signal that appears after init stops queued and later captures", async () => {
  let signal = false;
  const calls = [];
  let finishLoading;
  const runtime = createAnalyticsRuntime({
    env: VALID_ENV,
    routes: ROUTES,
    hasPrivacySignal: () => signal,
    loadPostHog: () =>
      new Promise((resolve) => {
        finishLoading = () =>
          resolve({
            init: () => calls.push("init"),
            capture: (event) => calls.push(event),
          });
      }),
  });
  const initialized = runtime.initialize();
  runtime.capturePageview("/");
  signal = true;
  finishLoading();
  await initialized;
  runtime.capturePageview("/compare");
  assert.deepEqual(calls, ["init"]);
});
