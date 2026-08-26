export const POSTHOG_API_HOST = "https://e.codeswhat.com";
export const POSTHOG_UI_HOST = "https://us.posthog.com";
export const PRODUCTION_ORIGIN = "https://getdrydock.com";

const PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]+$/u;
const OTHER_PATH = "/_other";
const COOKILESS_DISTINCT_ID = "$posthog_cookieless";

export const ANALYTICS_CTA_TUPLES = [
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
] as const;

const ALLOWED_CTA_TUPLES = new Set(ANALYTICS_CTA_TUPLES.map((tuple) => tuple.join("\0")));

const WEB_VITAL_KEYS = [
  "$web_vitals_CLS_value",
  "$web_vitals_FCP_value",
  "$web_vitals_INP_value",
  "$web_vitals_LCP_value",
] as const;

export type AnalyticsConfig = {
  token: string;
  apiHost: typeof POSTHOG_API_HOST;
  uiHost: typeof POSTHOG_UI_HOST;
};

export type AnalyticsEnvironment = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
  NEXT_PUBLIC_POSTHOG_UI_HOST?: string;
};

export type AnalyticsSurface = "marketing" | "docs";
export type AnalyticsCtaId =
  | "docs_root"
  | "github_repository"
  | "community_discord"
  | "install_quick"
  | "install_secure"
  | "docs_security";
export type AnalyticsCtaPlacement = "header" | "hero" | "comparison" | "get_started" | "footer";

type CaptureProperties = Record<string, unknown>;

type CaptureResult = {
  uuid: string;
  event: string;
  properties: CaptureProperties;
  timestamp?: Date;
  $set?: CaptureProperties;
  $set_once?: CaptureProperties;
  $unset?: string[];
};

export function getAnalyticsConfig(env: AnalyticsEnvironment): AnalyticsConfig | null {
  const token = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (
    typeof token !== "string" ||
    !PROJECT_TOKEN_PATTERN.test(token) ||
    env.NEXT_PUBLIC_POSTHOG_HOST !== POSTHOG_API_HOST ||
    env.NEXT_PUBLIC_POSTHOG_UI_HOST !== POSTHOG_UI_HOST
  ) {
    return null;
  }

  return {
    token,
    apiHost: POSTHOG_API_HOST,
    uiHost: POSTHOG_UI_HOST,
  };
}

export function canonicalizePathname(rawPathname: unknown, routes: ReadonlySet<string>): string {
  if (
    typeof rawPathname !== "string" ||
    !rawPathname.startsWith("/") ||
    rawPathname.startsWith("//")
  ) {
    return OTHER_PATH;
  }

  const queryIndex = rawPathname.indexOf("?");
  const hashIndex = rawPathname.indexOf("#");
  const boundary = Math.min(
    queryIndex === -1 ? rawPathname.length : queryIndex,
    hashIndex === -1 ? rawPathname.length : hashIndex,
  );
  const withoutSecrets = rawPathname.slice(0, boundary);
  const normalized = withoutSecrets === "/" ? withoutSecrets : withoutSecrets.replace(/\/+$/u, "");

  return routes.has(normalized) ? normalized : OTHER_PATH;
}

export function getSurface(rawPathname: unknown): AnalyticsSurface {
  if (
    typeof rawPathname === "string" &&
    (rawPathname === "/docs" || rawPathname.startsWith("/docs/"))
  ) {
    return "docs";
  }
  return "marketing";
}

export function isAllowedCta(surface: unknown, ctaId: unknown, placement: unknown): boolean {
  return (
    typeof surface === "string" &&
    typeof ctaId === "string" &&
    typeof placement === "string" &&
    ALLOWED_CTA_TUPLES.has(`${surface}\0${ctaId}\0${placement}`)
  );
}

function getRawPath(properties: CaptureProperties): unknown {
  if (typeof properties.path === "string") {
    return properties.path;
  }
  if (typeof properties.$current_url !== "string") {
    return undefined;
  }

  try {
    return new URL(properties.$current_url).pathname;
  } catch {
    return undefined;
  }
}

function createCommonProperties(
  token: string,
  input: CaptureProperties,
  rawPath: unknown,
  routes: ReadonlySet<string>,
): CaptureProperties {
  const path = canonicalizePathname(rawPath, routes);
  const properties: CaptureProperties = {
    token,
  };

  if (input.distinct_id === COOKILESS_DISTINCT_ID) {
    properties.distinct_id = COOKILESS_DISTINCT_ID;
  }
  if (input.$cookieless_mode === true) {
    properties.$cookieless_mode = true;
  }
  if (input.$process_person_profile === false) {
    properties.$process_person_profile = false;
  }

  properties.schema_version = 1;
  properties.site = "drydock";
  properties.surface = getSurface(rawPath);
  properties.path = path;

  return properties;
}

function createCaptureResult(input: CaptureResult, properties: CaptureProperties): CaptureResult {
  const result: CaptureResult = {
    uuid: input.uuid,
    event: input.event,
    properties,
  };

  if (input.timestamp instanceof Date && Number.isFinite(input.timestamp.getTime())) {
    result.timestamp = input.timestamp;
  }

  return result;
}

export function createBeforeSend(token: string, routes: ReadonlySet<string>) {
  return (input: CaptureResult | null): CaptureResult | null => {
    if (
      input === null ||
      typeof input !== "object" ||
      input.properties === null ||
      typeof input.properties !== "object" ||
      Array.isArray(input.properties)
    ) {
      return null;
    }

    // PostHog's cookieless server-hash ingestion reads $raw_user_agent and
    // $host straight off event properties and drops the event (silently,
    // with a cookieless_missing_user_agent / cookieless_missing_host
    // ingestion warning) if either is absent. Require and forward both.
    // $ip is intentionally never forwarded: PostHog's capture service fills
    // it in server-side from the request connection.
    const rawUserAgent = input.properties.$raw_user_agent;
    const host = input.properties.$host;
    if (
      typeof rawUserAgent !== "string" ||
      rawUserAgent === "" ||
      typeof host !== "string" ||
      host === ""
    ) {
      return null;
    }

    const rawPath = getRawPath(input.properties);
    const properties = createCommonProperties(token, input.properties, rawPath, routes);
    properties.$raw_user_agent = rawUserAgent;
    properties.$host = host;

    if (input.event === "$pageview" || input.event === "$pageleave") {
      // PostHog's Web analytics Page / Entry page / Exit page tables key off
      // $pathname, so without it those tables return no rows at all. Send
      // the already-canonicalized `path` rather than the raw pathname:
      // `path` has already been reduced to the known-route allowlist with
      // OTHER_PATH as the catch-all, so $pathname carries nothing the event
      // was not already sending and can never leak an unlisted route.
      properties.$current_url = `${PRODUCTION_ORIGIN}${properties.path}`;
      properties.$pathname = properties.path;
      return createCaptureResult(input, properties);
    }

    if (input.event === "cta activated") {
      if (!isAllowedCta(properties.surface, input.properties.cta_id, input.properties.placement)) {
        return null;
      }
      properties.cta_id = input.properties.cta_id;
      properties.placement = input.properties.placement;
      return createCaptureResult(input, properties);
    }

    if (input.event === "$web_vitals") {
      let metricCount = 0;
      for (const key of WEB_VITAL_KEYS) {
        const value = input.properties[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          properties[key] = value;
          metricCount += 1;
        }
      }
      if (metricCount === 0) {
        return null;
      }
      return createCaptureResult(input, properties);
    }

    return null;
  };
}
