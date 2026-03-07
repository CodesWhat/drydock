import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function normalizeManifestKey(assetUrl) {
  let normalized = assetUrl.split("#", 1)[0].split("?", 1)[0];
  if (normalized.startsWith("/_next/")) normalized = normalized.slice("/_next/".length);
  else if (normalized.startsWith("_next/")) normalized = normalized.slice("_next/".length);
  else if (normalized.startsWith("/")) normalized = normalized.slice(1);

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function resolveIntegrity(assetUrl, manifest) {
  const key = normalizeManifestKey(assetUrl);
  return manifest[key] ?? manifest[`/${key}`] ?? null;
}

function maybeAddSri(tag, assetUrl, manifest) {
  if (/\bintegrity\s*=/.test(tag)) return { tag, updated: false };
  const integrity = resolveIntegrity(assetUrl, manifest);
  if (!integrity) return { tag, updated: false };

  const closing = tag.endsWith("/>") ? "/>" : ">";
  const patched =
    tag.slice(0, -closing.length) + ` integrity="${integrity}" crossorigin="anonymous"` + closing;
  return { tag: patched, updated: true };
}

export function applySriToHtml(html, manifest) {
  let updatedTags = 0;

  const patch = (tag, assetUrl) => {
    if (!assetUrl.startsWith("/_next/")) return tag;
    const result = maybeAddSri(tag, assetUrl, manifest);
    if (result.updated) updatedTags += 1;
    return result.tag;
  };

  const withScriptSri = html.replace(
    /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g,
    (tag, assetUrl) => patch(tag, assetUrl),
  );
  const withLinkSri = withScriptSri.replace(
    /<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"[^>]*>/g,
    (tag, assetUrl) => patch(tag, assetUrl),
  );

  return { html: withLinkSri, updatedTags };
}

function walkHtmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const target = join(dir, name);
    const stat = statSync(target);
    if (stat.isDirectory()) {
      walkHtmlFiles(target, out);
    } else if (target.endsWith(".html")) {
      out.push(target);
    }
  }
  return out;
}

export function applySriToBuild({
  serverDir = join(".next", "server"),
  manifestPath = join(".next", "server", "subresource-integrity-manifest.json"),
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const htmlFiles = walkHtmlFiles(serverDir);

  let updatedFiles = 0;
  let updatedTags = 0;

  for (const file of htmlFiles) {
    const current = readFileSync(file, "utf8");
    const result = applySriToHtml(current, manifest);
    if (result.updatedTags === 0) continue;
    writeFileSync(file, result.html, "utf8");
    updatedFiles += 1;
    updatedTags += result.updatedTags;
  }

  return { updatedFiles, updatedTags };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = applySriToBuild();
  console.log(`Applied SRI to ${result.updatedTags} tag(s) across ${result.updatedFiles} HTML file(s).`);
}
