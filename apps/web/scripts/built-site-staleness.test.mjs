import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildIsStale, newestMtimeMs, staleBuildReason } from "./built-site-staleness.mjs";

const at = (path, seconds) => utimesSync(path, seconds, seconds);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "built-site-"));
  mkdirSync(join(root, "src/nested"), { recursive: true });
  mkdirSync(join(root, ".next"));
  writeFileSync(join(root, "src/a.ts"), "a");
  writeFileSync(join(root, "src/nested/b.ts"), "b");
  writeFileSync(join(root, ".next/BUILD_ID"), "id");
  at(join(root, "src/a.ts"), 1000);
  at(join(root, "src/nested/b.ts"), 2000);
  return root;
}

test("buildIsStale compares build time to the newest source", () => {
  assert.equal(buildIsStale(1, 2), true);
  assert.equal(buildIsStale(2, 2), false);
  assert.equal(buildIsStale(3, 2), false);
});

test("newestMtimeMs walks nested dirs and ignores missing ones", () => {
  const root = fixture();
  try {
    assert.equal(newestMtimeMs([join(root, "src"), join(root, "missing")]), 2000 * 1000);
    assert.equal(newestMtimeMs([join(root, "missing")]), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staleBuildReason reports missing, stale and fresh builds", () => {
  const root = fixture();
  const buildId = join(root, ".next/BUILD_ID");
  const dirs = [join(root, "src")];
  try {
    assert.match(staleBuildReason(join(root, ".next/NOPE"), dirs), /no \.next build/u);
    at(buildId, 1500);
    assert.match(staleBuildReason(buildId, dirs), /stale \.next build/u);
    at(buildId, 3000);
    assert.equal(staleBuildReason(buildId, dirs), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staleBuildReason rethrows unexpected errors", () => {
  assert.throws(() => staleBuildReason("/dev/null/BUILD_ID", []), /ENOTDIR/u);
});
