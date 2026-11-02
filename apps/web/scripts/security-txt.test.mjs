import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SITE_CONFIG } from "../src/lib/site-config.ts";

const webRoot = new URL("../", import.meta.url);
const raw = readFileSync(new URL("public/.well-known/security.txt", webRoot), "utf8");

const fields = new Map();
for (const line of raw.split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const at = line.indexOf(":");
  const name = line.slice(0, at).trim();
  fields.set(name, [...(fields.get(name) ?? []), line.slice(at + 1).trim()]);
}

const DAY = 86_400_000;
const MIN_DAYS_LEFT = 30;

test("security.txt carries the RFC 9116 required fields", () => {
  assert.deepEqual(fields.get("Contact"), ["mailto:security@getdrydock.com"]);
  assert.equal(fields.get("Expires")?.length, 1);
  assert.equal(
    fields.get("Canonical")?.[0],
    `https://${SITE_CONFIG.domain}/.well-known/security.txt`,
  );
  assert.match(fields.get("Policy")?.[0] ?? "", /^https:\/\/github\.com\/CodesWhat\/drydock\//);
});

test(`security.txt Expires is at least ${MIN_DAYS_LEFT} days away`, () => {
  const expires = new Date(fields.get("Expires")[0]);
  assert.ok(!Number.isNaN(expires.getTime()), "Expires must be an ISO 8601 date");
  const daysLeft = (expires.getTime() - Date.now()) / DAY;
  assert.ok(
    daysLeft >= MIN_DAYS_LEFT,
    `security.txt expires in ${Math.floor(daysLeft)} days. Renew: set Expires in ` +
      "apps/web/public/.well-known/security.txt to about six months out (under a year, per RFC 9116), " +
      "then ship it. The file is only valid until Expires.",
  );
});

test("vercel.json and the proxy leave /.well-known/security.txt alone", async () => {
  const vercel = JSON.parse(readFileSync(new URL("vercel.json", webRoot), "utf8"));
  for (const key of ["redirects", "rewrites"]) {
    for (const rule of vercel[key] ?? []) {
      assert.doesNotMatch(rule.source, /well-known|security\.txt/, `${key} rule would catch it`);
    }
  }
  // The only broad header rule must not override Content-Type.
  for (const rule of vercel.headers ?? []) {
    for (const header of rule.headers) {
      assert.notEqual(header.key.toLowerCase(), "content-type", rule.source);
    }
  }
  const { default: nextConfig } = await import("../next.config.mjs");
  for (const rule of [
    ...((await nextConfig.redirects?.()) ?? []),
    ...((await nextConfig.rewrites?.()) ?? []),
  ]) {
    assert.doesNotMatch(String(rule.source), /well-known|security\.txt/);
  }
  assert.doesNotMatch(readFileSync(new URL("src/proxy.ts", webRoot), "utf8"), /well-known/);
});
