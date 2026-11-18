import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";
import { buildContentSecurityPolicy } from "../src/lib/content-security-policy.mjs";

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
    "'unsafe-inline'",
    "https://e.codeswhat.com",
  ]);
  assert.deepEqual(getDirectiveSources(policy, "connect-src"), [
    "'self'",
    "https://e.codeswhat.com",
  ]);
}

test("production CSP is static: no nonce, scripts only from self and the analytics proxy", () => {
  const policy = buildContentSecurityPolicy(false);

  assert.doesNotMatch(policy, /nonce-/u);
  assert.doesNotMatch(policy, /strict-dynamic/u, "ignored next to unsafe-inline, so omit it");
  assert.doesNotMatch(getDirective(policy, "script-src"), /'unsafe-eval'/u);
  assertExactAnalyticsSources(policy);
});

test("CSP keeps every non-script directive strict", () => {
  const policy = buildContentSecurityPolicy(false);

  assert.deepEqual(getDirectiveSources(policy, "default-src"), ["'self'"]);
  assert.deepEqual(getDirectiveSources(policy, "object-src"), ["'none'"]);
  assert.deepEqual(getDirectiveSources(policy, "base-uri"), ["'self'"]);
  assert.deepEqual(getDirectiveSources(policy, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(getDirectiveSources(policy, "form-action"), ["'self'"]);
});

test("development CSP adds only unsafe-eval for React debugging", () => {
  const policy = buildContentSecurityPolicy(true);
  assert.match(getDirective(policy, "script-src"), /'unsafe-eval'/u);
});

test("CSP analytics allowlist rejects proxy prefix and suffix lookalikes", () => {
  const policy = buildContentSecurityPolicy(false);

  for (const source of [
    "https://e.codeswhat.com.attacker.invalid",
    "https://attacker.invalid/e.codeswhat.com",
  ]) {
    const hostilePolicy = policy.replaceAll("https://e.codeswhat.com", source);
    assert.throws(() => assertExactAnalyticsSources(hostilePolicy), assert.AssertionError);
  }
});

test("CSP permits the badge image origins the homepage hero loads", () => {
  const policy = buildContentSecurityPolicy(false);

  assert.deepEqual(getDirectiveSources(policy, "img-src"), [
    "'self'",
    "data:",
    "https://img.shields.io",
    "https://github.com",
    "https://qlty.sh",
    "https://www.bestpractices.dev",
    "https://codecov.io",
    "https://awesome.re",
    "https://api.star-history.com",
  ]);
});

test("next config serves the static CSP on pages and skips /api", async () => {
  const rules = await nextConfig.headers();
  const rule = rules.find((entry) =>
    entry.headers.some((header) => header.key === "Content-Security-Policy"),
  );
  assert.ok(rule, "expected a CSP headers rule in next.config.mjs");
  assert.equal(rule.source, "/((?!api/).*)");
  assert.equal(
    rule.headers.find((header) => header.key === "Content-Security-Policy").value,
    buildContentSecurityPolicy(process.env.NODE_ENV === "development"),
  );
});

test("no request-time proxy or nonce plumbing remains, so pages can prerender", () => {
  assert.equal(existsSync(new URL("../src/proxy.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/middleware.ts", import.meta.url)), false);

  const offenders = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = new URL(entry, dir);
      if (statSync(path).isDirectory()) {
        visit(new URL(`${entry}/`, dir));
      } else if (/\.(tsx?|mjs)$/u.test(entry)) {
        const text = readFileSync(path, "utf8");
        if (/next\/headers|x-nonce|force-dynamic/u.test(text)) {
          offenders.push(path.pathname);
        }
      }
    }
  };
  visit(new URL("../src/", import.meta.url));
  assert.deepEqual(offenders, []);
});

test("Vercel does not set a page CSP of its own, and /api gets a static strict one", () => {
  const pageEntries = vercelConfig.headers.filter((entry) => entry.source !== "/api/:path*");
  const headerNames = pageEntries.flatMap((entry) =>
    entry.headers.map((header) => header.key.toLowerCase()),
  );
  assert.equal(headerNames.includes("content-security-policy"), false);

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

test("site-wide headers keep the other security headers", () => {
  const entry = vercelConfig.headers.find((rule) => rule.source === "/(.*)");
  assert.ok(entry);
  const names = entry.headers.map((header) => header.key);
  for (const name of [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
    "Cross-Origin-Opener-Policy",
  ]) {
    assert.ok(names.includes(name), `${name} missing`);
  }
  assert.deepEqual(
    entry.headers.find((header) => header.key === "Cross-Origin-Opener-Policy"),
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  );
});

test("only development can embed the existing local demo on its fixed port", () => {
  const production = buildContentSecurityPolicy(false);
  const development = buildContentSecurityPolicy(true);
  assert.deepEqual(getDirectiveSources(production, "frame-src"), ["https://demo.getdrydock.com"]);
  assert.deepEqual(getDirectiveSources(development, "frame-src"), [
    "https://demo.getdrydock.com",
    "http://127.0.0.1:4179",
  ]);
  assert.ok(production.split("; ").includes("upgrade-insecure-requests"));
  assert.equal(getDirective(development, "upgrade-insecure-requests"), undefined);
});
