#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const repoRoot = join(webRoot, "..", "..");

const targetDir = join(webRoot, "content", "docs");

// Version definitions — order matters (first = default/active tab)
const versions = [
  { slug: "v1.5", source: "current", title: "v1.5" },
  { slug: "v1.4", source: "v1.4", title: "v1.4" },
  { slug: "v1.3", source: "v1.3", title: "v1.3" },
];

// Generate changelog MDX from root CHANGELOG.md (single source of truth).
// The root file is plain markdown — just prepend frontmatter and strip the
// top-level heading (the frontmatter title replaces it).
const changelogMd = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

const frontmatter = `---
title: "Changelog"
description: "All notable changes to this project will be documented in this file."
---`;

const body = changelogMd.replace(/^# Changelog\n/, "");

// Write changelog into the current (v1.5) source dir so it gets copied
const changelogDir = join(repoRoot, "content", "docs", "current", "changelog");
mkdirSync(changelogDir, { recursive: true });
writeFileSync(join(changelogDir, "index.mdx"), `${frontmatter}\n${body}`);
console.log("Generated changelog MDX from CHANGELOG.md");

// Clean target and recreate
if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}
mkdirSync(targetDir, { recursive: true });

// Copy each version as a subfolder with root: true meta.json
for (const ver of versions) {
  const sourceDir = join(repoRoot, "content", "docs", ver.source);
  if (!existsSync(sourceDir)) {
    console.error(`Missing docs source: ${sourceDir}`);
    process.exit(1);
  }

  const dest = join(targetDir, ver.slug);
  cpSync(sourceDir, dest, { force: true, recursive: true });

  // Override meta.json with root folder config for sidebar tabs
  const existingMeta = JSON.parse(readFileSync(join(dest, "meta.json"), "utf8"));
  writeFileSync(
    join(dest, "meta.json"),
    JSON.stringify({ ...existingMeta, title: ver.title, root: true }, null, 2),
  );

  console.log(`Synced ${ver.source} -> ${dest} (root folder: ${ver.title})`);
}

// Write top-level meta.json listing version folders
writeFileSync(
  join(targetDir, "meta.json"),
  JSON.stringify(
    {
      title: "Documentation",
      pages: versions.map((v) => v.slug),
    },
    null,
    2,
  ),
);

console.log("Docs sync complete");
