import {
  type AnalyticsEnvironment,
  canonicalizePathname,
  createBeforeSend,
  getAnalyticsConfig,
  getSurface,
  isAllowedCta,
  POSTHOG_API_HOST,
  POSTHOG_UI_HOST,
  PRODUCTION_ORIGIN,
} from "./analytics-contract.ts";

type AnalyticsProperties = Record<string, unknown>;

type PostHogClient = {
  init: (token: string, options: PostHogOptions) => unknown;
  capture: (event: string, properties: AnalyticsProperties) => unknown;
};

type PostHogOptions = {
  api_host: typeof POSTHOG_API_HOST;
  ui_host: typeof POSTHOG_UI_HOST;
  autocapture: false;
  rageclick: false;
  capture_pageview: false;
  capture_pageleave: true;
  disable_session_recording: true;
  capture_heatmaps: false;
  capture_dead_clicks: false;
  capture_exceptions: false;
  disable_surveys: true;
  disable_surveys_automatic_display: true;
  disable_product_tours: true;
  disable_web_experiments: true;
  advanced_disable_flags: true;
  person_profiles: "never";
  cookieless_mode: "always";
  persistence: "memory";
  disable_persistence: true;
  respect_dnt: true;
  save_referrer: false;
  save_campaign_params: false;
  disable_capture_url_hashes: true;
  disable_scroll_properties: true;
  mask_all_element_attributes: true;
  mask_all_text: true;
  capture_performance: {
    network_timing: false;
    web_vitals: true;
    web_vitals_allowed_metrics: ["CLS", "FCP", "INP", "LCP"];
    web_vitals_attribution: false;
  };
  before_send: ReturnType<typeof createBeforeSend>;
};

type QueuedCapture = [event: string, properties: AnalyticsProperties];

type AnalyticsRuntimeOptions = {
  env: AnalyticsEnvironment;
  routes: ReadonlySet<string>;
  getDoNotTrack: () => string | null | undefined;
  loadPostHog: () => Promise<PostHogClient>;
};

export function createPostHogOptions(token: string, routes: ReadonlySet<string>): PostHogOptions {
  return {
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
    save_referrer: false,
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
    before_send: createBeforeSend(token, routes),
  };
}

export function createAnalyticsRuntime({
  env,
  routes,
  getDoNotTrack,
  loadPostHog,
}: AnalyticsRuntimeOptions) {
  let state: "idle" | "loading" | "ready" | "disabled" = "idle";
  let client: PostHogClient | null = null;
  let initialization: Promise<void> | null = null;
  const queue: QueuedCapture[] = [];

  function dispatch(event: string, properties: AnalyticsProperties) {
    if (state === "ready" && client !== null) {
      client.capture(event, properties);
    } else if (state === "loading") {
      queue.push([event, properties]);
    }
  }

  function capturePageview(rawPathname: unknown) {
    const path = canonicalizePathname(rawPathname, routes);
    dispatch("$pageview", {
      path,
      surface: getSurface(rawPathname),
      $current_url: `${PRODUCTION_ORIGIN}${path}`,
    });
  }

  function captureCta(rawPathname: unknown, ctaId: unknown, placement: unknown) {
    const surface = getSurface(rawPathname);
    if (!isAllowedCta(surface, ctaId, placement)) {
      return;
    }
    dispatch("cta activated", {
      path: canonicalizePathname(rawPathname, routes),
      surface,
      cta_id: ctaId,
      placement,
    });
  }

  function initialize(): Promise<void> {
    if (initialization !== null) {
      return initialization;
    }

    const config = getAnalyticsConfig(env);
    if (config === null || getDoNotTrack() === "1") {
      state = "disabled";
      initialization = Promise.resolve();
      return initialization;
    }

    state = "loading";
    initialization = loadPostHog()
      .then((loadedClient) => {
        loadedClient.init(config.token, createPostHogOptions(config.token, routes));
        client = loadedClient;
        state = "ready";
        for (const [event, properties] of queue.splice(0)) {
          client.capture(event, properties);
        }
      })
      .catch(() => {
        queue.length = 0;
        state = "disabled";
        client = null;
      });

    return initialization;
  }

  return {
    initialize,
    capturePageview,
    captureCta,
  };
}
