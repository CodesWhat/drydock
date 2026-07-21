import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildContentSecurityPolicy } from "../src/lib/content-security-policy.mjs";

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

test("CSP builder rejects values that could inject another directive", () => {
  assert.throws(() => buildContentSecurityPolicy("nonce'; script-src *", false), /nonce/u);
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

test("custom inline scripts receive the request nonce", () => {
  assert.match(layoutSource, /await headers\(\)/u);
  assert.match(layoutSource, /<script nonce=\{nonce\}/u);
  assert.match(layoutSource, /<RootProvider theme=\{\{ nonce \}\}>/u);
  assert.match(jsonLdSource, /await headers\(\)/u);
  assert.match(jsonLdSource, /nonce=\{nonce\}/u);
  assert.match(jsonLdSource, /replace\(\/<\/g/u);
});

test("Vercel does not override the per-request CSP with a static policy", () => {
  const headerNames = vercelConfig.headers.flatMap((entry) =>
    entry.headers.map((header) => header.key.toLowerCase()),
  );

  assert.equal(headerNames.includes("content-security-policy"), false);
});
