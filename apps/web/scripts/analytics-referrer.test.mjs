import assert from "node:assert/strict";
import test from "node:test";
import { createBeforeSend } from "../src/lib/analytics-contract.ts";

test("referring hostnames survive the envelope without URLs or campaign data", () => {
  const sanitizeEvent = createBeforeSend("phc_referrer_fixture", new Set(["/"]));

  const accepted = ["github.com", "news.ycombinator.com", "$direct", "SEARCH.Example"];
  const rejected = [
    undefined,
    null,
    42,
    "",
    "https://search.example/private?email=me@example.com",
    "//search.example",
    "search.example/path",
    "search.example?x=1",
    "me@example.com",
    "search.example:443",
    "search.example\n",
    "-bad.example",
    "bad-.example",
    `${"a".repeat(64)}.example`,
  ];
  for (const event of ["$pageview", "$pageleave", "$web_vitals"]) {
    for (const value of [...accepted, ...rejected]) {
      const result = sanitizeEvent({
        event,
        properties: {
          token: "phc_referrer_fixture",
          $cookieless_mode: true,
          $process_person_profile: false,
          $raw_user_agent: "Mozilla/5.0 (Referrer Fixture)",
          $host: "getdrydock.com",
          path: "/",
          $web_vitals_LCP_value: 100,
          $referring_domain: value,
          $referrer: "https://search.example/private?email=me@example.com",
          utm_source: "me@example.com",
        },
      });
      assert.ok(result);
      assert.equal(
        result.properties.$referring_domain,
        accepted.includes(value) ? value.toLowerCase() : undefined,
        `${event}: ${JSON.stringify(value)}`,
      );
      assert.equal("$referrer" in result.properties, false);
      assert.equal("utm_source" in result.properties, false);
    }
  }
});
