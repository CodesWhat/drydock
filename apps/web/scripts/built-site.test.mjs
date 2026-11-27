// Checks against the production build in .next. Skipped when no build exists or it is
// older than the newest file under src or content/docs
// (`npm run build` first); the build itself is what proves the static render.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import nextConfig from "../next.config.mjs";
import { staleBuildReason } from "./built-site-staleness.mjs";

const next = new URL("../.next/", import.meta.url);
const staleReason = staleBuildReason(fileURLToPath(new URL("BUILD_ID", next)), [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../../../content/docs", import.meta.url)),
]);
const built = !staleReason && existsSync(new URL("prerender-manifest.json", next));
const opts = { skip: built ? false : staleReason || "no .next build (run `npm run build`)" };

const read = (path) => readFileSync(new URL(path, next), "utf8");
const manifest = built ? JSON.parse(read("prerender-manifest.json")) : { routes: {} };
const prerendered = new Set(Object.keys(manifest.routes));
const publicFile = (path) => existsSync(new URL(`../public${path}`, import.meta.url));

const redirectRules = built ? await nextConfig.redirects() : [];
const redirectsAway = (path) =>
  redirectRules.some((rule) => {
    const source = rule.source.replace(/:path\*/u, "(.*)").replace(/:path\((.*)\)$/u, "($1)");
    return new RegExp(`^${source}$`, "u").test(path);
  });

const resolves = (path) =>
  prerendered.has(path) || publicFile(path) || path.startsWith("/_next/") || redirectsAway(path);

function internalHrefs(html) {
  const hrefs = new Set();
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/gu)) {
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    hrefs.add(href.split("#")[0].split("?")[0].replace(/\/$/u, "") || "/");
  }
  hrefs.delete("");
  return hrefs;
}

test("every sitemap URL maps to a prerendered route (no 404s)", opts, () => {
  const urls = [...read("server/app/sitemap.xml.body").matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    (match) => new URL(match[1]),
  );
  assert.ok(urls.length > 20);
  const missing = urls
    .map((url) => url.pathname.replace(/\/$/u, "") || "/")
    .filter((path) => !prerendered.has(path));
  assert.deepEqual(missing, []);
});

test("sitemap lists only current docs, never an archived version", opts, () => {
  const body = read("server/app/sitemap.xml.body");
  assert.match(body, /\/docs\/v1\.9/u);
  assert.doesNotMatch(body, /\/docs\/v1\.[0-8]\b/u);
});

test("marketing pages and every docs version are prerendered, none is dynamic", opts, () => {
  for (const path of ["/", "/compare", "/security", "/docs/v1.9", "/docs/v1.7", "/docs/v1.3"]) {
    assert.ok(prerendered.has(path), `${path} is not prerendered`);
  }
  assert.ok(!existsSync(new URL("server/middleware.js", next)), "a middleware/proxy bundle exists");
  assert.ok(!existsSync(new URL("server/proxy.js", next)), "a middleware/proxy bundle exists");
});

test("every internal link on / and the docs landing resolves", opts, () => {
  const unresolved = [];
  let checked = 0;
  for (const [page, file] of [
    ["/", "server/app/index.html"],
    ["/docs/v1.9", "server/app/docs/v1.9.html"],
  ]) {
    for (const href of internalHrefs(read(file))) {
      checked += 1;
      if (!resolves(href)) unresolved.push(`${page} -> ${href}`);
    }
  }
  assert.ok(checked > 20, `only ${checked} links found`);
  assert.deepEqual(unresolved, []);
});

test("archived docs pages canonicalise to themselves, not the current docs", opts, () => {
  for (const path of ["/docs/v1.7", "/docs/v1.8"]) {
    const html = read(`server/app${path}.html`);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
    assert.equal(canonical, `https://getdrydock.com${path}`);
  }
});

test("pre-release docs lines show a notice linking to the stable line", opts, () => {
  const notice = /Pre-release docs/u;
  for (const path of ["/docs/v1.9", "/docs/v1.8"]) {
    const html = read(`server/app${path}.html`);
    assert.match(html, notice, `${path} has no pre-release notice`);
    assert.match(html, /href="\/docs\/v1\.7[^"]*"/u, `${path} notice does not link to v1.7`);
  }
  assert.doesNotMatch(read("server/app/docs/v1.7.html"), notice);
  assert.doesNotMatch(read("server/app/docs/v1.6.html"), notice);
});

test("robots.txt does not disallow archived docs versions", opts, () => {
  const body = read("server/app/robots.txt.body");
  assert.doesNotMatch(body, /Disallow: \/docs\//u);
});
