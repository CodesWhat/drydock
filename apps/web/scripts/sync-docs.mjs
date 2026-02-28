#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Generate changelog MDX from root CHANGELOG.md (single source of truth).
// The root file is plain markdown — just prepend frontmatter and strip the
// top-level heading (the frontmatter title replaces it).
const changelogMd = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

const frontmatter = `---
title: "Changelog"
description: "All notable changes to this project will be documented in this file."
---`;

const body = changelogMd.replace(/^# Changelog\n/, "");

const changelogDir = join(sourceDir, "changelog");
mkdirSync(changelogDir, { recursive: true });
writeFileSync(join(changelogDir, "index.mdx"), `${frontmatter}\n${body}`);
console.log(`Generated changelog MDX from CHANGELOG.md`);

// Copy current docs to web app content dir
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { force: true, recursive: true });

console.log(`Synced docs: ${sourceDir} -> ${targetDir}`);
