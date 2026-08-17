import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function source(relativePath) {
  const target = join(webRoot, relativePath);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

test("PostHog replaces both Vercel telemetry packages at one exact version", () => {
  const packageJson = JSON.parse(source("package.json"));

  assert.equal(packageJson.dependencies["posthog-js"], "1.417.1");
  assert.equal(packageJson.dependencies["@vercel/analytics"], undefined);
  assert.equal(packageJson.dependencies["@vercel/speed-insights"], undefined);
});

test("route generation is a checked build and development prerequisite", () => {
  const scripts = JSON.parse(source("package.json")).scripts;

  assert.equal(scripts["sync:analytics-routes"], "node scripts/analytics-routes.mjs");
  assert.equal(scripts["check:analytics-routes"], "node scripts/analytics-routes.mjs --check");
  assert.match(scripts.build, /^npm run check:analytics-routes && /u);
  assert.match(scripts.dev, /^npm run check:analytics-routes && /u);
});

test("instrumentation-client is the only analytics initializer and loads PostHog dynamically", () => {
  const instrumentation = source("src/instrumentation-client.ts");
  const analytics = source("src/lib/analytics.ts");
  const sourceFiles = walk(join(webRoot, "src")).filter((file) => /\.(?:ts|tsx)$/u.test(file));
  const initCallers = sourceFiles.filter((file) =>
    /\binitializeAnalytics\(\)/u.test(readFileSync(file, "utf8")),
  );

  assert.match(instrumentation, /void initializeAnalytics\(\)/u);
  assert.deepEqual(
    initCallers.map((file) => file.slice(webRoot.length + 1)),
    ["src/instrumentation-client.ts"],
  );
  assert.match(analytics, /import\("posthog-js"\)/u);
  assert.match(analytics, /process\.env\.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN/u);
  assert.match(analytics, /process\.env\.NEXT_PUBLIC_POSTHOG_HOST/u);
  assert.match(analytics, /process\.env\.NEXT_PUBLIC_POSTHOG_UI_HOST/u);
});

test("committed pathname changes emit one pageview through the shared layout", () => {
  const component = source("src/components/analytics-pageview.tsx");
  const layout = source("src/app/layout.tsx");

  assert.match(component, /usePathname\(\)/u);
  assert.match(component, /useEffect/u);
  assert.match(component, /lastPathname/u);
  assert.match(component, /capturePageview\(pathname\)/u);
  assert.match(layout, /<AnalyticsPageview\s*\/>/u);
  assert.doesNotMatch(layout, /@vercel\/analytics|@vercel\/speed-insights/u);
});

test("tracked links validate explicit CTA ids and placements at activation time", () => {
  const trackedLink = source("src/components/tracked-link.tsx");

  assert.match(trackedLink, /usePathname\(\)/u);
  assert.match(trackedLink, /captureCta\(pathname, ctaId, placement\)/u);
  assert.match(trackedLink, /data-analytics-cta/u);
  assert.match(trackedLink, /data-analytics-placement/u);
});

test("the cookieless envelope keeps the fields PostHog's server hash requires", () => {
  const contract = source("src/lib/analytics-contract.ts");

  // PostHog's cookieless server-hash ingestion step reads $raw_user_agent and
  // $host straight off event.properties and drops the event — with a
  // cookieless_missing_user_agent / cookieless_missing_host ingestion warning
  // and zero rows ingested — if either is absent. posthog-js attaches both by
  // default; before_send must require and forward them, not silently strip
  // them. Regression guard: if these keys ever disappear from before_send (or
  // the comment explaining why they're there), every cookieless event on
  // Drydock drops with no PostHog-side error beyond the ingestion warning.
  assert.match(contract, /\$raw_user_agent/u);
  assert.match(contract, /\$host/u);
  assert.match(contract, /cookieless_missing_user_agent|cookieless server-hash/u);
});

test("all approved Drydock CTA families have exact annotations", () => {
  const header = source("src/components/site-header.tsx");
  const buttons = source("src/components/cta-buttons.tsx");
  const hero = source("src/components/hero.tsx");
  const comparison = source("src/components/comparison-page.tsx");
  const getStarted = source("src/components/get-started.tsx");
  const footer = source("src/components/footer.tsx");
  const starHistory = source("src/components/star-history.tsx");

  assert.match(header, /ctaId="docs_root"\s+placement="header"/u);
  assert.match(header, /ctaId="github_repository"\s+placement="header"/u);
  assert.match(buttons, /placement: "hero" \| "comparison"/u);
  assert.match(buttons, /ctaId="github_repository"\s+placement=\{placement\}/u);
  assert.match(buttons, /ctaId="docs_root"\s+placement=\{placement\}/u);
  assert.match(hero, /<CtaButtons[^>]*placement="hero"/u);
  assert.match(comparison, /<CtaButtons[^>]*placement="comparison"/u);
  assert.match(getStarted, /captureCta\(pathname, `install_\$\{id\}`, "get_started"\)/u);
  assert.match(getStarted, /ctaId="docs_security"\s+placement="get_started"/u);
  assert.match(footer, /ctaId: "docs_root"/u);
  assert.match(footer, /ctaId: "github_repository"/u);
  assert.match(footer, /ctaId="community_discord"\s+placement="footer"/u);
  assert.match(starHistory, /ctaId="github_repository"\s+placement="star_history"/u);
});
