import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import { buildContentSecurityPolicy } from "../src/lib/content-security-policy.mjs";

// Next compiles matcher sources with its bundled path-to-regexp.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp");

const proxySource = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const jsonLdSource = readFileSync(
  new URL("../src/components/json-ld.tsx", import.meta.url),
  "utf8",
);
const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function getDirective(policy, name) {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

function getDirectiveSources(policy, name) {
  const directive = getDirective(policy, name);
  assert.ok(directive);
  return directive.split(/\s+/u).slice(1);
}

function assertExactAnalyticsSources(policy) {
  assert.deepEqual(getDirectiveSources(policy, "script-src"), [
    "'self'",
    "'nonce-c2VjdXJlLW5vbmNl'",
    "'strict-dynamic'",
    "https://e.codeswhat.com",
  ]);
  assert.deepEqual(getDirectiveSources(policy, "connect-src"), [
    "'self'",
    "https://e.codeswhat.com",
  ]);
}

test("production CSP permits only nonce-authorized inline scripts", () => {
  const policy = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", false);
  const scriptDirective = getDirective(policy, "script-src");

  assert.match(scriptDirective, /'nonce-c2VjdXJlLW5vbmNl'/u);
  assert.match(scriptDirective, /'strict-dynamic'/u);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/u);
  assert.doesNotMatch(scriptDirective, /'unsafe-eval'/u);
});

test("development CSP permits React debugging without permitting arbitrary inline scripts", () => {
  const policy = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", true);
  const scriptDirective = getDirective(policy, "script-src");

  assert.match(scriptDirective, /'unsafe-eval'/u);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/u);
});

test("CSP permits only the managed PostHog proxy for analytics scripts and requests", () => {
  const policy = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", false);

  assertExactAnalyticsSources(policy);
});

test("CSP analytics allowlist rejects proxy prefix and suffix lookalikes", () => {
  const policy = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", false);

  for (const source of [
    "https://e.codeswhat.com.attacker.invalid",
    "https://attacker.invalid/e.codeswhat.com",
  ]) {
    const hostilePolicy = policy.replaceAll("https://e.codeswhat.com", source);
    assert.throws(() => assertExactAnalyticsSources(hostilePolicy), assert.AssertionError);
  }
});

test("CSP builder rejects values that could inject another directive", () => {
  assert.throws(() => buildContentSecurityPolicy("nonce'; script-src *", false), /nonce/u);
});

test("CSP permits the badge image origins the homepage hero loads", () => {
  const policy = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", false);

  assert.deepEqual(getDirectiveSources(policy, "img-src"), [
    "'self'",
    "data:",
    "https://img.shields.io",
    "https://github.com",
    "https://qlty.sh",
    "https://www.bestpractices.dev",
    "https://codecov.io",
    "https://awesome.re",
  ]);
});

test("proxy propagates a fresh nonce and CSP through request and response headers", () => {
  assert.match(proxySource, /crypto\.randomUUID\(\)/u);
  assert.match(proxySource, /requestHeaders\.set\("x-nonce", nonce\)/u);
  assert.match(
    proxySource,
    /requestHeaders\.set\("Content-Security-Policy", contentSecurityPolicy\)/u,
  );
  assert.match(
    proxySource,
    /response\.headers\.set\("Content-Security-Policy", contentSecurityPolicy\)/u,
  );
  assert.match(proxySource, /_next\/static/u);
  assert.match(proxySource, /next-router-prefetch/u);
});

test("proxy matcher skips only /api and /api/*, so /api-prefixed lookalikes still get the CSP", () => {
  const source = proxySource.match(/source:\s*"([^"]+)"/u)?.[1];
  assert.ok(source, "proxy matcher source not found");
  const matcher = pathToRegexp(source);
  for (const path of ["/api,", "/apiary", "/api-docs", "/", "/docs"]) {
    assert.ok(matcher.test(path), `${path} should be matched by the proxy`);
  }
  for (const path of ["/api", "/api/x", "/api/", "/_next/static/a.js", "/favicon.ico"]) {
    assert.ok(!matcher.test(path), `${path} should not be matched by the proxy`);
  }
});

test("custom inline scripts receive the request nonce", () => {
  assert.match(layoutSource, /await headers\(\)/u);
  assert.match(layoutSource, /<script nonce=\{nonce\}/u);
  assert.match(layoutSource, /<RootProvider theme=\{\{ nonce \}\}>/u);
  assert.match(jsonLdSource, /await headers\(\)/u);
  assert.match(jsonLdSource, /nonce=\{nonce\}/u);
  assert.match(jsonLdSource, /replace\(\/<\/g/u);
});

test("Vercel does not override the per-request CSP on site pages with a static policy", () => {
  // /api is excluded from src/proxy.ts, so it gets a static CSP; every other
  // route must keep relying on the nonce CSP set per request.
  const pageEntries = vercelConfig.headers.filter((entry) => entry.source !== "/api/:path*");
  const headerNames = pageEntries.flatMap((entry) =>
    entry.headers.map((header) => header.key.toLowerCase()),
  );

  assert.equal(headerNames.includes("content-security-policy"), false);
});

test("/api responses get a static strict CSP because the proxy skips them", () => {
  const entry = vercelConfig.headers.find((rule) => rule.source === "/api/:path*");
  assert.ok(entry, "expected a /api/:path* headers rule");
  const csp = entry.headers.find((header) => header.key === "Content-Security-Policy");
  assert.ok(csp);
  assert.equal(
    csp.value,
    "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  assert.equal(getDirective(csp.value, "script-src"), undefined);
});

test("site-wide headers send Cross-Origin-Opener-Policy same-origin", () => {
  const entry = vercelConfig.headers.find((rule) => rule.source === "/(.*)");
  assert.ok(entry);
  assert.deepEqual(
    entry.headers.find((header) => header.key === "Cross-Origin-Opener-Policy"),
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  );
});

test("only development can embed the existing local demo on its fixed port", () => {
  const production = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", false);
  const development = buildContentSecurityPolicy("c2VjdXJlLW5vbmNl", true);
  assert.deepEqual(getDirectiveSources(production, "frame-src"), ["https://demo.getdrydock.com"]);
  assert.deepEqual(getDirectiveSources(development, "frame-src"), [
    "https://demo.getdrydock.com",
    "http://127.0.0.1:4179",
  ]);
  assert.ok(production.split("; ").includes("upgrade-insecure-requests"));
  assert.equal(getDirective(development, "upgrade-insecure-requests"), undefined);
});
