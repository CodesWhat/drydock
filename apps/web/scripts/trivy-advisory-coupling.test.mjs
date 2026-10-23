import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Mirror the repoRoot logic from sync-docs.mjs:
// scriptDir = apps/web/scripts/, webRoot = apps/web/, repoRoot = repo root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const repoRoot = join(webRoot, "..", "..");

const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
const advisoryPage = readFileSync(
  join(webRoot, "src", "app", "security", "trivy-supply-chain-march-2026", "page.tsx"),
  "utf8",
);

// The image stopped bundling Trivy in v1.8.0. The advisory page used to quote the
// Dockerfile's `trivy-bin` digest and a "Current Drydock images ship Trivy X" claim; both
// would now be false, so this guards against the image and the page drifting apart again.
test("Dockerfile no longer bundles a Trivy binary", () => {
  assert.doesNotMatch(dockerfile, /AS trivy-bin/);
  assert.doesNotMatch(dockerfile, /COPY --from=trivy-bin/);
  assert.doesNotMatch(dockerfile, /apk add[^\n]*trivy/);
});

test("advisory page does not claim current images ship Trivy", () => {
  assert.doesNotMatch(advisoryPage, /Current Drydock images ship Trivy/);
  assert.match(advisoryPage, /image contains no Trivy binary at all/);
  assert.match(advisoryPage, /v1\.7\.x images only/);
});
