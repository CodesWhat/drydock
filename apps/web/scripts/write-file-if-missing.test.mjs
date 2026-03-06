import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeFileIfMissing } from "./write-file-if-missing.mjs";

test("writeFileIfMissing writes a new file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "write-if-missing-"));

  try {
    const target = join(tempDir, "meta.json");
    const created = writeFileIfMissing(target, "first\n");

    assert.equal(created, true);
    assert.equal(readFileSync(target, "utf-8"), "first\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeFileIfMissing does not overwrite existing file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "write-if-missing-"));

  try {
    const target = join(tempDir, "meta.json");
    writeFileIfMissing(target, "first\n");

    const created = writeFileIfMissing(target, "second\n");

    assert.equal(created, false);
    assert.equal(readFileSync(target, "utf-8"), "first\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
