#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { writeFileIfMissing } from "./write-file-if-missing.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..");

const SRC = join(repoRoot, "docs");
const DEST = join(repoRoot, "content", "docs", "current");

// Directories/files to exclude
const EXCLUDES = ["planning", "node_modules", "_coverpage.md", "sidebar.md", "security"];

// Collect all .md files recursively
function collectFiles(dir, base = dir) {
  let results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(base, full);
    const stat = statSync(full);

    // Skip excluded dirs/files
    const topLevel = rel.split("/")[0];
    if (EXCLUDES.includes(topLevel)) continue;
    if (EXCLUDES.includes(entry)) continue;

    if (stat.isDirectory()) {
      results = results.concat(collectFiles(full, base));
    } else if (entry.endsWith(".md")) {
      results.push({ full, rel: relative(base, full) });
    }
  }
  return results;
}

// Extract title from first # heading
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}

// Extract description from first paragraph after heading
const DESCRIPTION_MAX_LENGTH = 160;
const DESCRIPTION_SKIP_PREFIXES = ["#", "![", "|", "?>", "!>"];

function isSkippableDescriptionLine(line) {
  return line === "" || DESCRIPTION_SKIP_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function formatDescription(description) {
  const sentenceMatch = description.match(/^(.+?[.!?])\s/);
  if (sentenceMatch && sentenceMatch[1].length <= DESCRIPTION_MAX_LENGTH) {
    return sentenceMatch[1];
  }

  return description.substring(0, DESCRIPTION_MAX_LENGTH);
}

function extractDescription(content) {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  if (headingIndex === -1) return "";

  const description =
    lines
      .slice(headingIndex + 1)
      .map((line) => line.trim())
      .find((line) => !isSkippableDescriptionLine(line)) ?? "";

  if (description === "") return "";
  return formatDescription(description);
}

// Convert Docsify callouts (?> and !>) to Fumadocs Callout components
const INFO_CALLOUT_REGEX = /^\?>\s*(.*)/;
const WARN_CALLOUT_REGEX = /^!>\s*(.*)/;
const ANY_CALLOUT_REGEX = /^[?!]>\s/;

function parseCalloutLine(line) {
  const infoMatch = line.match(INFO_CALLOUT_REGEX);
  if (infoMatch) {
    return { type: "info", text: infoMatch[1] };
  }

  const warnMatch = line.match(WARN_CALLOUT_REGEX);
  if (warnMatch) {
    return { type: "warn", text: warnMatch[1] };
  }

  return null;
}

function isWrappedCalloutContinuation(text, nextLine) {
  return text.endsWith("  ") && nextLine.trim() !== "" && !ANY_CALLOUT_REGEX.test(nextLine);
}

function consumeCalloutContinuation(lines, startIndex, initialText) {
  let lineIndex = startIndex;
  let text = initialText;

  // Handle multi-line callouts:
  // 1. Lines ending with \ are explicit continuations
  // 2. Lines ending with two spaces continue into a non-empty, non-callout next line
  while (lineIndex + 1 < lines.length) {
    if (text.endsWith("\\")) {
      text = text.slice(0, -1).trimEnd();
    } else if (isWrappedCalloutContinuation(text, lines[lineIndex + 1])) {
      text = text.trimEnd();
    } else {
      break;
    }

    lineIndex++;
    text += "\n" + lines[lineIndex].trim();
  }

  return { lineIndex, text };
}

function convertCallouts(content) {
  const lines = content.split("\n");
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const callout = parseCalloutLine(lines[i]);
    if (!callout) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const { lineIndex, text } = consumeCalloutContinuation(lines, i, callout.text);
    result.push(`<Callout type="${callout.type}">${text}</Callout>`);
    i = lineIndex + 1;
  }

  return result.join("\n");
}

// Convert Docsify tabs to Fumadocs Tabs components
function convertTabs(content) {
  const tabBlockRegex = /<!-- tabs:start -->([\s\S]*?)<!-- tabs:end -->/g;

  return content.replace(tabBlockRegex, (match, block) => {
    const tabs = [];
    // Match both #### **Name** and ### **Name** tab headers
    const tabRegex = /(?:#{3,4})\s+\*\*(.+?)\*\*/g;
    let tabMatch;
    const tabHeaders = [];

    while ((tabMatch = tabRegex.exec(block)) !== null) {
      tabHeaders.push({ name: tabMatch[1], index: tabMatch.index, fullMatch: tabMatch[0] });
    }

    for (let t = 0; t < tabHeaders.length; t++) {
      const name = tabHeaders[t].name;
      const start = tabHeaders[t].index + tabHeaders[t].fullMatch.length;
      const end = t + 1 < tabHeaders.length ? tabHeaders[t + 1].index : block.length;
      const tabContent = block.substring(start, end).trim();
      tabs.push({ name, content: tabContent });
    }

    if (tabs.length === 0) return match;

    const tabNames = tabs.map((t) => `"${t.name}"`).join(", ");
    let output = `<Tabs items={[${tabNames}]}>`;
    for (const tab of tabs) {
      output += `\n<Tab value="${tab.name}">\n${tab.content}\n</Tab>`;
    }
    output += "\n</Tabs>";
    return output;
  });
}

// Convert relative links to Fumadocs format
// In Docsify, all relative links resolve from the docs root, not from the current file
function convertLinks(content, fileRelDir) {
  return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, text, href) => {
    // Skip external links
    if (href.startsWith("http://") || href.startsWith("https://")) return match;
    // Skip anchor-only links
    if (href.startsWith("#")) return match;
    // Skip mail links
    if (href.startsWith("mailto:")) return match;
    // Skip image references (handled separately)
    if (/\.(png|jpg|gif|svg|ico)$/i.test(href.split("#")[0].split("?")[0])) return match;

    // In Docsify, both relative and absolute links resolve from docs root
    let resolved = href;

    // Normalize: convert ?id= to #
    resolved = resolved.replace(/\?id=/, "#");

    // Ensure leading slash
    if (!resolved.startsWith("/")) {
      resolved = "/" + resolved;
    }

    // Remove trailing slashes (but not from root /)
    resolved = resolved.replace(/\/+$/, "") || "/";

    // Prepend /docs if not already
    if (!resolved.startsWith("/docs")) {
      resolved = "/docs" + resolved;
    }

    // Clean up double slashes (preserve # anchors)
    const hashIdx = resolved.indexOf("#");
    if (hashIdx !== -1) {
      const path = resolved.substring(0, hashIdx).replace(/\/+/g, "/");
      const hash = resolved.substring(hashIdx);
      resolved = path + hash;
    } else {
      resolved = resolved.replace(/\/+/g, "/");
    }

    // Remove trailing slash (but keep root)
    if (hashIdx === -1 && resolved.length > 1) {
      resolved = resolved.replace(/\/$/, "");
    }

    return `[${text}](${resolved})`;
  });
}

// Convert local image references
function convertImages(content, fileRelDir) {
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    // Skip external images (URLs)
    if (src.startsWith("http://") || src.startsWith("https://")) return match;
    // Skip already-absolute /docs/assets paths
    if (src.startsWith("/docs/assets/")) return match;

    // Handle relative image path starting with ./
    const cleanSrc = src.startsWith("./") ? src.substring(2) : src;

    // For absolute paths starting with / (Docsify root-relative), treat as root-relative
    if (cleanSrc.startsWith("/")) {
      return `![${alt}](/docs/assets${cleanSrc})`;
    }

    let imgPath;
    if (fileRelDir && fileRelDir !== ".") {
      imgPath = `/docs/assets/${fileRelDir}/${cleanSrc}`;
    } else {
      imgPath = `/docs/assets/${cleanSrc}`;
    }

    return `![${alt}](${imgPath})`;
  });
}

// Remove the first heading line (it's in frontmatter now)
function removeFirstHeading(content) {
  return content.replace(/^#\s+.+\n/, "");
}

// Serialize as a YAML-compatible double-quoted scalar.
function quoteYamlScalar(value) {
  return JSON.stringify(String(value));
}

// Process a single markdown file
function processFile(srcPath, relPath) {
  let content = readFileSync(srcPath, "utf-8");
  const title = extractTitle(content);
  const description = extractDescription(content);

  // Get the relative directory of this file within the docs root
  const fileRelDir = dirname(relPath) === "." ? "" : dirname(relPath);

  // Remove first heading (now in frontmatter)
  content = removeFirstHeading(content);

  // Convert Docsify syntax
  content = convertCallouts(content);
  content = convertTabs(content);
  content = convertLinks(content, fileRelDir);
  content = convertImages(content, fileRelDir);

  // Determine required imports
  const imports = [];
  if (content.includes("<Callout")) {
    imports.push("import { Callout } from 'fumadocs-ui/components/callout';");
  }
  if (content.includes("<Tabs") || content.includes("<Tab ")) {
    imports.push("import { Tab, Tabs } from 'fumadocs-ui/components/tabs';");
  }

  // Build frontmatter
  // Serialize title/description with safe escaping for frontmatter values.
  const safeTitle = quoteYamlScalar(title);
  const safeDesc = quoteYamlScalar(description);
  let frontmatter = `---\ntitle: ${safeTitle}\ndescription: ${safeDesc}\n---\n`;

  if (imports.length > 0) {
    frontmatter += "\n" + imports.join("\n") + "\n";
  }

  const output = frontmatter + "\n" + content.trimStart();

  // Determine output path
  const dir = dirname(relPath);
  const file = basename(relPath);
  let outName;
  if (file === "README.md") {
    outName = "index.mdx";
  } else {
    outName = file.replace(/\.md$/, ".mdx");
  }

  const outDir = dir === "." ? DEST : join(DEST, dir);
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, outName);
  writeFileSync(outPath, output);
  console.log(`  ${relPath} -> ${relative(DEST, outPath)}`);
}

// Meta.json definitions
const META_FILES = {
  "": {
    title: "Documentation",
    pages: [
      "index",
      "quickstart",
      "configuration",
      "updates",
      "api",
      "monitoring",
      "faq",
      "changelog",
    ],
  },
  configuration: {
    title: "Configuration",
    pages: [
      "index",
      "agents",
      "authentications",
      "logs",
      "registries",
      "security",
      "server",
      "storage",
      "timezone",
      "triggers",
      "watchers",
    ],
  },
  "configuration/registries": {
    title: "Registries",
    pages: [
      "index",
      "acr",
      "custom",
      "docr",
      "dhi",
      "ecr",
      "forgejo",
      "gcr",
      "ghcr",
      "gitea",
      "gitlab",
      "hub",
      "lscr",
      "trueforge",
      "quay",
    ],
  },
  "configuration/triggers": {
    title: "Triggers",
    pages: [
      "index",
      "apprise",
      "command",
      "discord",
      "docker",
      "docker-compose",
      "gotify",
      "http",
      "ifttt",
      "kafka",
      "mqtt",
      "ntfy",
      "pushover",
      "rocketchat",
      "slack",
      "smtp",
      "telegram",
    ],
  },
  "configuration/authentications": {
    title: "Authentication",
    pages: ["index", "basic", "oidc"],
  },
  api: {
    title: "API",
    pages: ["index", "agent", "app", "container", "log", "registry", "store", "trigger", "watcher"],
  },
  "configuration/watchers": {
    title: "Watchers",
    pages: ["index", "popular-imgsets"],
  },
};

// Directories that only have index.mdx
const INDEX_ONLY_DIRS = [
  { path: "quickstart", title: "Quick Start" },
  { path: "faq", title: "FAQ" },
  { path: "monitoring", title: "Monitoring" },
  { path: "updates", title: "Updates" },
  { path: "changelog", title: "Changelog" },
  { path: "configuration/agents", title: "Agents" },
  { path: "configuration/logs", title: "Logs" },
  { path: "configuration/security", title: "🥊 Update Bouncer" },
  { path: "configuration/server", title: "Server" },
  { path: "configuration/storage", title: "Storage" },
  { path: "configuration/timezone", title: "Timezone" },
  { path: "configuration/authentications/basic", title: "Basic" },
  { path: "configuration/authentications/oidc", title: "OIDC" },
  // Registry subdirs
  { path: "configuration/registries/acr", title: "ACR" },
  { path: "configuration/registries/custom", title: "Custom" },
  { path: "configuration/registries/docr", title: "DOCR" },
  { path: "configuration/registries/dhi", title: "DHI" },
  { path: "configuration/registries/ecr", title: "ECR" },
  { path: "configuration/registries/forgejo", title: "Forgejo" },
  { path: "configuration/registries/gcr", title: "GCR" },
  { path: "configuration/registries/ghcr", title: "GHCR" },
  { path: "configuration/registries/gitea", title: "Gitea" },
  { path: "configuration/registries/gitlab", title: "GitLab" },
  { path: "configuration/registries/hub", title: "Docker Hub" },
  { path: "configuration/registries/lscr", title: "LSCR" },
  { path: "configuration/registries/trueforge", title: "TrueForge" },
  { path: "configuration/registries/quay", title: "Quay" },
  // Trigger subdirs
  { path: "configuration/triggers/apprise", title: "Apprise" },
  { path: "configuration/triggers/command", title: "Command" },
  { path: "configuration/triggers/discord", title: "Discord" },
  { path: "configuration/triggers/docker", title: "Docker" },
  { path: "configuration/triggers/docker-compose", title: "Docker Compose" },
  { path: "configuration/triggers/gotify", title: "Gotify" },
  { path: "configuration/triggers/http", title: "HTTP" },
  { path: "configuration/triggers/ifttt", title: "IFTTT" },
  { path: "configuration/triggers/kafka", title: "Kafka" },
  { path: "configuration/triggers/mqtt", title: "MQTT" },
  { path: "configuration/triggers/ntfy", title: "Ntfy" },
  { path: "configuration/triggers/pushover", title: "Pushover" },
  { path: "configuration/triggers/rocketchat", title: "Rocket.Chat" },
  { path: "configuration/triggers/slack", title: "Slack" },
  { path: "configuration/triggers/smtp", title: "SMTP" },
  { path: "configuration/triggers/telegram", title: "Telegram" },
];

function writeMeta() {
  // Write main meta.json files
  for (const [dir, meta] of Object.entries(META_FILES)) {
    const outDir = dir ? join(DEST, dir) : DEST;
    mkdirSync(outDir, { recursive: true });
    const metaPath = join(outDir, "meta.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    console.log(`  meta.json -> ${dir || "(root)"}/meta.json`);
  }

  // Write index-only directory meta.json files
  for (const { path: dir, title } of INDEX_ONLY_DIRS) {
    const outDir = join(DEST, dir);
    mkdirSync(outDir, { recursive: true });
    const metaPath = join(outDir, "meta.json");
    // Only write if not already written by META_FILES (atomically).
    const wasWritten = writeFileIfMissing(
      metaPath,
      JSON.stringify({ title, pages: ["index"] }, null, 2) + "\n",
    );
    if (wasWritten) {
      console.log(`  meta.json -> ${dir}/meta.json`);
    }
  }
}

console.log("Migrating Docsify docs to Fumadocs MDX...\n");

// Collect files
const files = collectFiles(SRC);
console.log(`Found ${files.length} markdown files to process.\n`);

// Process each file
console.log("Converting files:");
for (const { full, rel } of files) {
  processFile(full, rel);
}

// Write meta.json files
console.log("\nWriting meta.json files:");
writeMeta();

console.log("\nMigration complete!");
