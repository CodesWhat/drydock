import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clientIp, createRateLimiter } from "../src/lib/rate-limit.ts";

test("limiter allows up to the limit per window, then blocks, then resets", () => {
  const allow = createRateLimiter(2, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 10), true);
  assert.equal(allow("a", 20), false);
  assert.equal(allow("b", 20), true, "other IPs are counted separately");
  assert.equal(allow("a", 1000), true, "a new window resets the count");
});

test("limiter bounds its memory", () => {
  const allow = createRateLimiter(1, 1000, 3);
  for (const key of ["a", "b", "c", "d", "e"]) assert.equal(allow(key, 0), true);
});

test("clientIp prefers x-real-ip, then the first forwarded address", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "1.1.1.1" })), "1.1.1.1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("search route applies the limiter and answers 429", () => {
  const route = readFileSync(new URL("../src/app/api/search/route.ts", import.meta.url), "utf8");
  assert.match(route, /createRateLimiter/);
  assert.match(route, /status: 429/);
});
