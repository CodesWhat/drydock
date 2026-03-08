import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import nextConfig from "../next.config.mjs";

test("next config enables SRI for frontend bundles", () => {
  assert.equal(nextConfig.experimental?.sri?.algorithm, "sha384");
});

test("production build uses webpack so SRI is applied", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.scripts?.build ?? "", /\bnext build\b[\s\S]*--webpack\b/);
  assert.match(packageJson.scripts?.build ?? "", /\bnode\s+scripts\/apply-sri\.mjs\b/);
});
