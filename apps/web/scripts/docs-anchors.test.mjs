import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  docsPathForFile,
  findCrossPageDocAnchors,
  findSamePageAnchors,
  headingSlugsForSource,
  isDirectory,
  listMdxFiles,
} from "./docs-anchors.mjs";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const docsRoot = join(scriptDir, "..", "..", "..", "content", "docs", "current");

async function buildSlugIndex() {
  const files = listMdxFiles(docsRoot);
  const bySourcePath = new Map();
  const byDocsPath = new Map();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const slugs = new Set(await headingSlugsForSource(source));
    const docsPath = docsPathForFile(docsRoot, file);
    bySourcePath.set(file, { source, slugs, docsPath });
    byDocsPath.set(docsPath, slugs);
  }

  return { files, bySourcePath, byDocsPath };
}

// Every /docs/... target that isn't itself a page (e.g. /docs/configuration
// resolves fine, but a target that 404s isn't an anchor problem this check
// owns) still needs to resolve to a real page before its anchor is checkable.
// Assets and off-site links never carry a same-page-checkable anchor.
function isCheckableDocsPath(path) {
  return path !== "/docs/assets" && !path.startsWith("/docs/assets/");
}

test("every same-page #anchor link resolves to a real heading id", async () => {
  const { bySourcePath } = await buildSlugIndex();
  const failures = [];

  for (const [file, { source, slugs }] of bySourcePath) {
    for (const anchor of findSamePageAnchors(source)) {
      if (!slugs.has(anchor)) {
        failures.push(`${file}: #${anchor} has no matching heading on the same page`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("every cross-page /docs/...#anchor link resolves to a heading id on the target page", async () => {
  const { bySourcePath, byDocsPath } = await buildSlugIndex();
  const failures = [];

  for (const [file, { source }] of bySourcePath) {
    for (const { path, anchor } of findCrossPageDocAnchors(source)) {
      if (!isCheckableDocsPath(path)) continue;

      const targetSlugs = byDocsPath.get(path);
      if (!targetSlugs) {
        // A dead /docs/... path is a routing problem, not an anchor problem —
        // out of scope for this check.
        continue;
      }
      if (!targetSlugs.has(anchor)) {
        failures.push(`${file}: ${path}#${anchor} has no matching heading on ${path}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

// Regression cases for the three anchors DOC-3 found dead: the heading text
// contains "&" or "/", which github-slugger turns into a double hyphen
// (adjacent-whitespace collapse around a stripped punctuation character), not
// the single hyphen a naive slug guess would produce.
test("DOC-3 regression: docker-compose links to the docker trigger's Image Backup & Rollback heading", async () => {
  const file = join(docsRoot, "configuration", "triggers", "docker-compose", "index.mdx");
  const source = readFileSync(file, "utf8");
  const links = findCrossPageDocAnchors(source);
  assert.ok(
    links.some(
      (link) =>
        link.path === "/docs/configuration/triggers/docker" &&
        link.anchor === "image-backup--rollback",
    ),
    "expected docker-compose/index.mdx to link to /docs/configuration/triggers/docker#image-backup--rollback",
  );

  const targetSource = readFileSync(
    join(docsRoot, "configuration", "triggers", "docker", "index.mdx"),
    "utf8",
  );
  const targetSlugs = await headingSlugsForSource(targetSource);
  assert.ok(targetSlugs.includes("image-backup--rollback"));
});

test("DOC-3 regression: watchers links to its own WATCHALL / WATCHBYDEFAULT behavior matrix heading", async () => {
  const file = join(docsRoot, "configuration", "watchers", "index.mdx");
  const source = readFileSync(file, "utf8");
  assert.ok(findSamePageAnchors(source).includes("watchall--watchbydefault-behavior-matrix"));

  const slugs = await headingSlugsForSource(source);
  assert.ok(slugs.includes("watchall--watchbydefault-behavior-matrix"));
});

test("DOC-3 regression: updates links to the ui config's Language / Locale heading", async () => {
  const file = join(docsRoot, "updates", "index.mdx");
  const source = readFileSync(file, "utf8");
  const links = findCrossPageDocAnchors(source);
  assert.ok(
    links.some(
      (link) => link.path === "/docs/configuration/ui" && link.anchor === "language--locale",
    ),
    "expected updates/index.mdx to link to /docs/configuration/ui#language--locale",
  );

  const targetSource = readFileSync(join(docsRoot, "configuration", "ui", "index.mdx"), "utf8");
  const targetSlugs = await headingSlugsForSource(targetSource);
  assert.ok(targetSlugs.includes("language--locale"));
});

test("docsPathForFile derives the site path the sync step publishes", () => {
  assert.equal(
    docsPathForFile(docsRoot, join(docsRoot, "configuration", "watchers", "index.mdx")),
    "/docs/configuration/watchers",
  );
  assert.equal(docsPathForFile(docsRoot, join(docsRoot, "index.mdx")), "/docs");
});

test("docsRoot exists and is a directory", () => {
  assert.ok(isDirectory(docsRoot));
});
