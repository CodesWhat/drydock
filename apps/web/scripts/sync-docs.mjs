#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { versions } from "./docs-versions.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const repoRoot = join(webRoot, "..", "..");

const targetDir = join(webRoot, "content", "docs");
const tmpDir = join(webRoot, "content", "docs.tmp");

// Resolve changelog path — DD_CHANGELOG_PATH overrides the default so a sibling
// site that doesn't have a root CHANGELOG.md can still use this script.
const changelogPath = process.env.DD_CHANGELOG_PATH ?? join(repoRoot, "CHANGELOG.md");

// Strip HTML comments (<!-- ... -->) before emitting MDX. They are valid in the
// GitHub-rendered CHANGELOG (used for maintainer-only notes) but MDX v3 rejects
// them ("use {/* */}"), which fails the fumadocs/Turbopack build. They are not
// published-docs content, so drop them, then collapse the blank-line gap left
// behind so the generated MDX stays tidy.
//
// An index scan is used instead of a `/<!--[\s\S]*?-->/g` replace on purpose: a
// single-pass regex replace can leave a residual "<!--" when comment spans abut,
// which CodeQL flags as incomplete sanitization (js/incomplete-multi-character-
// sanitization). This walks each complete span out of the string and leaves any
// unterminated trailing "<!--" as-is.
function stripHtmlComments(text) {
  let result = "";
  let cursor = 0;
  for (let open = text.indexOf("<!--"); open !== -1; open = text.indexOf("<!--", cursor)) {
    const close = text.indexOf("-->", open + 4);
    if (close === -1) {
      break;
    }
    result += text.slice(cursor, open);
    cursor = close + 3;
  }
  return result + text.slice(cursor);
}

// Generate changelog MDX from CHANGELOG.md (single source of truth).
// The root file is plain markdown — just prepend frontmatter and strip the
// top-level heading (the frontmatter title replaces it).
// changelogMdx is null when the file is absent (sibling-site portability).
let changelogMdx = null;

if (existsSync(changelogPath)) {
  const changelogMd = readFileSync(changelogPath, "utf8");

  const frontmatter = `---
title: "Changelog"
description: "All notable changes to this project will be documented in this file."
---`;

  const body = stripHtmlComments(changelogMd.replace(/^# Changelog\n/, "")).replace(
    /\n{3,}/g,
    "\n\n",
  );

  changelogMdx = `${frontmatter}\n${body}`;
  console.log("Generated changelog MDX from CHANGELOG.md");
} else {
  console.warn(`No CHANGELOG.md at ${changelogPath}; skipping changelog generation`);
}

// Build into a temp directory so a mid-run crash can't leave a blank docs site.
if (existsSync(tmpDir)) {
  rmSync(tmpDir, { recursive: true, force: true });
}
mkdirSync(tmpDir, { recursive: true });

// Copy each version as a subfolder with root: true meta.json
for (const ver of versions) {
  const sourceDir = join(repoRoot, "content", "docs", ver.source);
  if (!existsSync(sourceDir)) {
    console.error(`Missing docs source: ${sourceDir}`);
    process.exit(1);
  }

  const dest = join(tmpDir, ver.slug);
  cpSync(sourceDir, dest, { force: true, recursive: true });

  // Override meta.json with root folder config for sidebar tabs
  const existingMeta = JSON.parse(readFileSync(join(dest, "meta.json"), "utf8"));
  writeFileSync(
    join(dest, "meta.json"),
    JSON.stringify({ ...existingMeta, title: ver.title, root: true }, null, 2),
  );

  console.log(`Synced ${ver.source} -> ${dest} (root folder: ${ver.title})`);
}

// Write changelog into the active version's slug in the build target.
// This keeps the generated file out of the source tree entirely.
if (changelogMdx !== null) {
  const changelogDir = join(tmpDir, versions[0].slug, "changelog");
  mkdirSync(changelogDir, { recursive: true });
  writeFileSync(join(changelogDir, "index.mdx"), changelogMdx);
}

// Write top-level meta.json listing version folders
writeFileSync(
  join(tmpDir, "meta.json"),
  JSON.stringify(
    {
      title: "Documentation",
      pages: versions.map((v) => v.slug),
    },
    null,
    2,
  ),
);

// Atomic swap: rename the fully-built temp dir into place.
// The empty-target window is reduced to a single OS rename.
if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}
renameSync(tmpDir, targetDir);

console.log("Docs sync complete");
