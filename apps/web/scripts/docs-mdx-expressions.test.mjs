import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import remarkCustomHeadingId from "remark-custom-heading-id";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import remarkLiteralIdentifierExpressions from "../src/lib/remark-literal-identifier-expressions.mjs";

const docsRoot = new URL("../content/docs/", import.meta.url).pathname;

function listMdx(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listMdx(full);
    return /\.mdx?$/u.test(entry.name) ? [full] : [];
  });
}

function collectExpressions(node, found = []) {
  if (node.type === "mdxTextExpression" || node.type === "mdxFlowExpression") {
    if (!/^\s*\/\*[\s\S]*\*\/\s*$/u.test(node.value ?? "")) {
      found.push(node.value);
    }
  }
  for (const child of node.children ?? []) {
    collectExpressions(child, found);
  }
  return found;
}

function processor(withPlugin) {
  const base = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkCustomHeadingId);
  return withPlugin ? base.use(remarkLiteralIdentifierExpressions) : base;
}

async function parse(source, withPlugin) {
  const p = processor(withPlugin);
  return p.run(p.parse(source));
}

test("bare {identifier} in prose is rendered as literal text", async () => {
  const tree = await parse(
    'A muted "{column} - hidden to fit" and {countdown} then {date}.\n',
    true,
  );
  assert.deepEqual(collectExpressions(tree), []);
  const text = JSON.stringify(tree);
  assert.match(text, /\{column\}/u);
  assert.match(text, /\{countdown\}/u);
  assert.match(text, /\{date\}/u);
});

test("comments and real expressions are left alone", async () => {
  const tree = await parse("{/* note */}\n\nvalue {a.b} and {1 + 1}\n", true);
  assert.deepEqual(collectExpressions(tree), ["a.b", "1 + 1"]);
});

test("without the plugin the bare identifier is an expression (guards the test itself)", async () => {
  const tree = await parse("hidden {column}\n", false);
  assert.deepEqual(collectExpressions(tree), ["column"]);
});

// MDX compiles {identifier} to a JS expression that throws ReferenceError when the
// page renders. The docs render per request (layout.tsx awaits headers() for the CSP
// nonce), so `next build` never catches it and the page 500s in production.
test("no docs page contains an unresolved MDX expression after the remark pipeline", async () => {
  assert.ok(existsSync(docsRoot), "run `npm run sync:docs` first: content/docs is generated");
  const files = listMdx(docsRoot);
  assert.ok(files.length > 100, "expected the synced docs tree");
  const offenders = [];
  for (const file of files) {
    const tree = await parse(readFileSync(file, "utf8"), true);
    for (const value of collectExpressions(tree)) {
      offenders.push(`${file.slice(docsRoot.length)}: {${value}}`);
    }
  }
  assert.deepEqual(offenders, []);
});
