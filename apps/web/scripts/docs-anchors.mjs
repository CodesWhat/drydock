// Walks content/docs/current/**/*.mdx, computes each page's heading ids with
// the same remark pipeline the site's MDX build uses (see source.config.ts),
// and resolves every in-repo anchor link — same-page `#slug` and cross-page
// `/docs/...#slug` — against those ids. Links are collected from the parsed
// mdast tree, not the raw source, so link-shaped text inside code spans and
// fenced code blocks is never scanned. content/docs/v1.x/** is out of scope
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

// Walk the mdast tree (not the raw source) for link destinations. `link` is
// every markdown/MDX link; `definition` is the target of a reference-style
// link (`[text][ref]` / `[ref]: /target`) — content/docs/current doesn't use
// that form today, but it's cheap to cover so a future doc that does isn't
// silently skipped. Recursing into `children` rather than doing a source
// regex means text inside a fenced code block or inline code span — which
// mdast represents as `code`/`inlineCode` leaf nodes with a `value`, not as
// parsed markdown — is never visited, so a link-shaped literal like
// `` `[example](#missing)` `` in a code sample can't be mistaken for a link.
function collectLinkUrls(node, urls) {
  if (node.type === "link" || node.type === "definition") {
    urls.push(node.url);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectLinkUrls(child, urls);
    }
  }
}

function linkCollectorPlugin(urls) {
  return () => (tree) => {
    collectLinkUrls(tree, urls);
  };
}

async function linkUrlsForSource(source) {
  const urls = [];
  await compile(source, {
    outputFormat: "function-body",
    remarkPlugins: [...REMARK_PLUGINS, linkCollectorPlugin(urls)],
  });
  return urls;
}

const DOCS_ANCHOR_URL_RE = /^(\/docs(?:\/[^#]*)?)#(.+)$/;

// Links like /docs/configuration/triggers/#anchor carry a trailing slash
// that byDocsPath's keys (built from docsPathForFile, which never emits one)
// don't, so the lookup would silently miss and the anchor would never be
// checked. Strip it before the lookup, keeping "/docs" itself as the root.
// A path that still doesn't match any indexed page after normalising is a
// dead page path — a routing problem outside this anchor check, not
// something this function decides; callers keep skipping those.
export function normalizeDocsPath(path) {
  return path !== "/docs" && path.endsWith("/") ? path.slice(0, -1) : path;
}

export async function findSamePageAnchors(source) {
  const urls = await linkUrlsForSource(source);
  return urls.filter((url) => url.startsWith("#")).map((url) => url.slice(1));
}

export async function findCrossPageDocAnchors(source) {
  const urls = await linkUrlsForSource(source);
  const links = [];
  for (const url of urls) {
    const match = url.match(DOCS_ANCHOR_URL_RE);
    if (!match) continue;
    links.push({ path: normalizeDocsPath(match[1]), anchor: match[2] });
  }
  return links;
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
