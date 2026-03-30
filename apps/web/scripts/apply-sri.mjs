#!/usr/bin/env node

/**
 * Post-build SRI injection.
 *
 * Next.js generates an `integrity-manifest.json` when `experimental.sri` is
 * enabled, but it only applies integrity attributes to dynamically injected
 * scripts/stylesheets. Statically rendered HTML pages (SSG output in
 * `.next/server/app/`) still reference `/_next/static/*` assets without
 * `integrity` or `crossorigin` attributes.
 *
 * This script walks every `.html` file under `.next/server/app/`, matches
 * `<script>` and `<link rel="stylesheet">` tags pointing at `/_next/static/*`,
 * looks up their integrity hash from the manifest, and injects the attributes.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NEXT_DIR = join(process.cwd(), ".next");
const MANIFEST_PATH = join(NEXT_DIR, "integrity-manifest.json");
const APP_DIR = join(NEXT_DIR, "server", "app");

/**
 * Apply SRI attributes to `_next/static` script and stylesheet tags in HTML.
 *
 * Exported for unit testing.
 *
 * @param {string} html  Raw HTML string
 * @param {Record<string, string>} manifest  Map of `static/...` keys to integrity hashes
 * @returns {{ html: string; updatedTags: number }}
 */
export function applySriToHtml(html, manifest) {
  let updatedTags = 0;

  const updated = html.replace(
    /(<(?:script|link)\b[^>]*?\b(?:src|href)="(\/_next\/[^"]+)"[^>]*?)(\s*\/?>)/g,
    (match, before, rawUrl, closing) => {
      if (match.includes("integrity=")) {
        return match;
      }

      const decodedUrl = decodeURIComponent(rawUrl);
      const key = decodedUrl.replace(/^\/_next\//, "");
      const integrity = manifest[key];

      if (!integrity) {
        return match;
      }

      updatedTags++;
      return `${before} integrity="${integrity}" crossorigin="anonymous"${closing}`;
    },
  );

  return { html: updated, updatedTags };
}

// ---- CLI entry point (skipped when imported as a module by tests) ----

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  if (!existsSync(MANIFEST_PATH)) {
    console.log("No integrity-manifest.json found — skipping SRI injection");
    process.exit(0);
  }

  if (!existsSync(APP_DIR)) {
    console.log("No .next/server/app/ directory — skipping SRI injection");
    process.exit(0);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  let totalFiles = 0;
  let totalTags = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".html")) {
        continue;
      }

      const html = readFileSync(full, "utf8");
      const { html: updated, updatedTags } = applySriToHtml(html, manifest);

      if (updatedTags > 0) {
        writeFileSync(full, updated);
        totalFiles++;
        totalTags += updatedTags;
      }
    }
  }

  walk(APP_DIR);
  console.log(`SRI: patched ${totalTags} tags across ${totalFiles} HTML files`);
}
