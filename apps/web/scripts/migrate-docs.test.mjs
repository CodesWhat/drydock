import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_SCRIPT_PATH = fileURLToPath(new URL("./migrate-docs.mjs", import.meta.url));
const WRITE_IF_MISSING_SCRIPT_PATH = fileURLToPath(new URL("./write-file-if-missing.mjs", import.meta.url));

test("migrate-docs escapes backslashes and quotes in YAML frontmatter", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "migrate-docs-"));

  try {
    const tempScriptDir = join(tempRoot, "apps", "web", "scripts");
    const copiedScriptPath = join(tempScriptDir, "migrate-docs.mjs");
    const copiedWriteIfMissingPath = join(tempScriptDir, "write-file-if-missing.mjs");
    const docsDir = join(tempRoot, "docs");

    mkdirSync(tempScriptDir, { recursive: true });
    mkdirSync(docsDir, { recursive: true });

    cpSync(SOURCE_SCRIPT_PATH, copiedScriptPath);
    cpSync(WRITE_IF_MISSING_SCRIPT_PATH, copiedWriteIfMissingPath);

    writeFileSync(
      join(docsDir, "README.md"),
      [
        "# Path \\ docs and \"quotes\"",
        "",
        "Use C:\\Users\\tester and \"double quotes\" safely.",
        "",
      ].join("\n"),
      "utf-8",
    );

    execFileSync(process.execPath, [copiedScriptPath], {
      cwd: tempScriptDir,
      env: process.env,
      stdio: "pipe",
    });

    const generated = readFileSync(join(tempRoot, "content", "docs", "current", "index.mdx"), "utf-8");

    assert.ok(generated.includes('title: "Path \\\\ docs and \\"quotes\\""'));
    assert.ok(generated.includes('description: "Use C:\\\\Users\\\\tester and \\"double quotes\\" safely."'));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
