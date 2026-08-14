import { createAnalyticsRuntime } from "./analytics-client.ts";
import { ANALYTICS_ROUTES } from "./analytics-routes.generated.ts";

const runtime = createAnalyticsRuntime({
  env: {
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
  },
  routes: ANALYTICS_ROUTES,
  getDoNotTrack: () => (typeof navigator === "undefined" ? null : navigator.doNotTrack),
  loadPostHog: async () => (await import("posthog-js")).default,
});

export const initializeAnalytics = runtime.initialize;
export const capturePageview = runtime.capturePageview;
export const captureCta = runtime.captureCta;
