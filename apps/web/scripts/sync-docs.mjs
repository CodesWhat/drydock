#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const repoRoot = join(webRoot, "..", "..");

const sourceDir = join(repoRoot, "content", "docs", "current");
const targetDir = join(webRoot, "content", "docs");

if (!existsSync(sourceDir)) {
  console.error(`Missing docs source: ${sourceDir}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { force: true, recursive: true });

console.log(`Synced docs: ${sourceDir} -> ${targetDir}`);
