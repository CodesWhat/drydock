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

const dockerfilePath = join(repoRoot, "Dockerfile");
const advisoryPagePath = join(
  webRoot,
  "src",
  "app",
  "security",
  "trivy-supply-chain-march-2026",
  "page.tsx",
);

const dockerfile = readFileSync(dockerfilePath, "utf8");
const advisoryPage = readFileSync(advisoryPagePath, "utf8");

// Extract the digest pinned on the `trivy-bin` build stage, e.g.:
// FROM aquasec/trivy@sha256:<digest> AS trivy-bin
const trivyBinMatch = dockerfile.match(/FROM aquasec\/trivy@sha256:([a-f0-9]{64}) AS trivy-bin/);

test("Dockerfile pins the trivy-bin stage to a digest", () => {
  assert.ok(
    trivyBinMatch,
    "Dockerfile must contain a digest-pinned `aquasec/trivy@sha256:... AS trivy-bin` line",
  );
});

test("advisory page quotes the current Dockerfile trivy-bin digest", () => {
  const dockerfileDigest = trivyBinMatch[1];
  assert.ok(
    advisoryPage.includes(`sha256:${dockerfileDigest}`),
    `Dockerfile's Trivy pin moved to sha256:${dockerfileDigest} but the advisory page ` +
      "(src/app/security/trivy-supply-chain-march-2026/page.tsx) still quotes a different " +
      "digest. Update the page.",
  );
});

test("advisory page does not quote a stale trivy digest alongside the current one", () => {
  const dockerfileDigest = trivyBinMatch[1];
  const digestMatches = [...advisoryPage.matchAll(/aquasec\/trivy@sha256:([a-f0-9]{64})/g)].map(
    (m) => m[1],
  );
  assert.ok(
    digestMatches.length > 0,
    "advisory page should quote at least one aquasec/trivy@sha256 digest",
  );
  const staleDigests = digestMatches.filter((d) => d !== dockerfileDigest);
  assert.deepEqual(
    staleDigests,
    [],
    `advisory page quotes stale aquasec/trivy@sha256 digest(s) [${staleDigests.join(", ")}] ` +
      `alongside the current Dockerfile digest (${dockerfileDigest}); remove the stale one`,
  );
});

// The advisory page also mentions "Trivy X.Y.Z" inside a dated "Correction
// (July 18)" paragraph, deliberately reworded to a historical past-tense claim
// ("the bundled version was Trivy 0.72.0 at that time") so it does NOT track
// the current shipped version. A blanket regex sweep of every "Trivy X.Y.Z"
// mention would false-positive against that intentional historical value, so
// instead we compare the two specific present-tense "what ships today" claims
// that must always agree with each other: the `# Expected: X` comment in the
// verification code block, and the "Current Drydock images ship Trivy X"
// sentence just above it.
test("verification code block version agrees with the current-shipped-version claim", () => {
  const expectedMatch = advisoryPage.match(/# Expected: (\d+\.\d+\.\d+)/);
  const shipsMatch = advisoryPage.match(/Current Drydock images ship Trivy (\d+\.\d+\.\d+)/);

  assert.ok(
    expectedMatch,
    "advisory page must contain a `# Expected: X.Y.Z` comment in the verification code block",
  );
  assert.ok(
    shipsMatch,
    'advisory page must contain a "Current Drydock images ship Trivy X.Y.Z" claim',
  );
  assert.equal(
    expectedMatch[1],
    shipsMatch[1],
    `verification comment says Trivy ${expectedMatch[1]} but the "Current Drydock images ship" ` +
      `claim says Trivy ${shipsMatch[1]}; these must name the same version`,
  );
});
