import assert from "node:assert/strict";
import { test } from "node:test";

import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import remarkGithubAlerts from "../src/lib/remark-github-alerts.mjs";

async function run(source, withPlugin = true) {
  const p = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);
  if (withPlugin) p.use(remarkGithubAlerts);
  return p.run(p.parse(source));
}

function attr(node, name) {
  return node.attributes.find((a) => a.name === name)?.value;
}

function text(node) {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(text).join("");
}

test("[!WARNING] becomes a Callout of type warn with a title", async () => {
  const tree = await run("> [!WARNING]\n> **Back up first.** Then upgrade.\n");
  const [callout] = tree.children;
  assert.equal(callout.type, "mdxJsxFlowElement");
  assert.equal(callout.name, "Callout");
  assert.equal(attr(callout, "type"), "warn");
  assert.equal(attr(callout, "title"), "Warning");
  assert.ok(!text(callout).includes("[!WARNING]"));
  assert.match(text(callout), /Back up first\. Then upgrade\./u);
});

test("every GitHub alert kind maps to a Callout type", async () => {
  const expected = {
    NOTE: ["info", "Note"],
    TIP: ["idea", "Tip"],
    IMPORTANT: ["warn", "Important"],
    WARNING: ["warn", "Warning"],
    CAUTION: ["error", "Caution"],
  };
  for (const [kind, [type, title]] of Object.entries(expected)) {
    const tree = await run(`> [!${kind}]\n> body\n`);
    const [callout] = tree.children;
    assert.equal(callout.name, "Callout", kind);
    assert.equal(attr(callout, "type"), type, kind);
    assert.equal(attr(callout, "title"), title, kind);
  }
});

test("marker on its own line with later paragraphs keeps them", async () => {
  const tree = await run("> [!NOTE]\n>\n> first\n>\n> second\n");
  const [callout] = tree.children;
  assert.equal(callout.name, "Callout");
  assert.equal(callout.children.length, 2);
});

test("plain blockquotes and unknown markers are untouched", async () => {
  const tree = await run("> **Fork point:** x\n\n> [!BOGUS]\n> y\n\n> not [!NOTE] at start\n");
  assert.deepEqual(
    tree.children.map((c) => c.type),
    ["blockquote", "blockquote", "blockquote"],
  );
});

test("alerts nested in lists are converted too", async () => {
  const tree = await run("- item\n\n  > [!TIP]\n  > nested\n");
  const item = tree.children[0].children[0];
  assert.ok(item.children.some((c) => c.name === "Callout"));
});

test("without the plugin the marker stays literal (guards the test itself)", async () => {
  const tree = await run("> [!WARNING]\n> x\n", false);
  assert.equal(tree.children[0].type, "blockquote");
  assert.match(text(tree), /\[!WARNING\]/u);
});

test("the docs source config registers the plugin", async () => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../source.config.ts", import.meta.url), "utf8");
  assert.match(config, /remarkGithubAlerts/u);
});
