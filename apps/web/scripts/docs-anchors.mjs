// Walks content/docs/current/**/*.mdx, computes each page's heading ids with
// the same remark pipeline the site's MDX build uses (see source.config.ts),
// and resolves every in-repo anchor link — same-page `#slug` and cross-page
// `/docs/...#slug` — against those ids. content/docs/v1.x/** is out of scope
// on purpose: those directories are frozen GA snapshots and are never rebuilt.

import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { compile } from "@mdx-js/mdx";
import { remarkGfm, remarkHeading } from "fumadocs-core/mdx-plugins";
import remarkCustomHeadingId from "remark-custom-heading-id";

// Same plugin order as apps/web/source.config.ts's defineConfig(), minus the
// bundler-only image/codeTab/structure plugins that don't affect heading ids.
const REMARK_PLUGINS = [remarkGfm, [remarkHeading, { generateToc: false }], remarkCustomHeadingId];

export function listMdxFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMdxFiles(target));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".mdx") {
      files.push(target);
    }
  }
  return files;
}

// content/docs/current/configuration/watchers/index.mdx -> /docs/configuration/watchers
// content/docs/current/index.mdx                         -> /docs
export function docsPathForFile(docsRoot, filePath) {
  const rel = relative(docsRoot, filePath).split(sep).join("/");
  const withoutIndex = rel.replace(/(^|\/)index\.mdx$/, "").replace(/\.mdx$/, "");
  return withoutIndex ? `/docs/${withoutIndex}` : "/docs";
}

export async function headingSlugsForSource(source) {
  const file = await compile(source, {
    outputFormat: "function-body",
    remarkPlugins: REMARK_PLUGINS,
  });
  const text = String(file);
  return [...text.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

const SAME_PAGE_ANCHOR_RE = /\]\(#([^)\s]+)\)/g;
const DOCS_ANCHOR_RE = /\]\((\/docs(?:\/[^)#\s]*)?)#([^)\s]+)\)/g;

export function findSamePageAnchors(source) {
  return [...source.matchAll(SAME_PAGE_ANCHOR_RE)].map((match) => match[1]);
}

export function findCrossPageDocAnchors(source) {
  return [...source.matchAll(DOCS_ANCHOR_RE)].map((match) => ({
    path: match[1],
    anchor: match[2],
  }));
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
