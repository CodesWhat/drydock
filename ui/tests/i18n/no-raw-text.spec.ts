/**
 * SFC raw-text gate — catches hardcoded prose in TEXT nodes and static user-facing attributes.
 *
 * KNOWN LIMITATION (documented honestly, not a bug): it does NOT catch English string literals
 * inside {{ }} interpolations (e.g. {{ x ? 'yes' : 'no' }}) or in .ts/.vue <script> blocks —
 * those are indistinguishable from enum/key/CSS literals without huge false positives; code review
 * covers them. Reference: #329.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseParse, NodeTypes } from '@vue/compiler-core';
import { parse } from '@vue/compiler-sfc';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

// A run of ≥2 letters = a word (user-facing prose indicator)
const PROSE = /\p{L}{2,}/u;

// Tags whose text content is legitimately non-translated (code samples, keycaps)
const CODEISH_TAGS = new Set(['code', 'pre', 'kbd']);

// Static attributes that are user-facing and must be translated
const USER_FACING_ATTRS = new Set(['title', 'placeholder', 'alt', 'aria-label', 'label']);

// Legitimate non-prose static text — each entry justified in a comment
const ALLOWED_TEXT = new Set([
  'spdx-json', // SBOM format identifier (proper noun), shown as <option> label
  'cyclonedx-json', // SBOM format identifier (proper noun), shown as <option> label
  'CSV', // export-format identifier / acronym
  'JSON', // export-format identifier / acronym
  'DRYDOCK', // brand wordmark
]);

// Legitimate non-prose static attribute values
const ALLOWED_ATTR = new Set([
  'Drydock', // brand name in alt text
]);

interface Violation {
  file: string;
  line: number;
  text: string;
}

function collectVueFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectVueFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      results.push(fullPath);
    }
  }
  return results;
}

function countNewlines(str: string, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (str[i] === '\n') count++;
  }
  return count;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkAst(
  node: any,
  templateContent: string,
  baseLine: number,
  relativePath: string,
  violations: Violation[],
  inCodeish: boolean,
): void {
  if (node.type === NodeTypes.TEXT) {
    const txt = (node.content as string).trim().replace(/\s+/g, ' ');
    if (txt && PROSE.test(txt) && !inCodeish && !ALLOWED_TEXT.has(txt)) {
      const line = baseLine + countNewlines(templateContent, node.loc.start.offset as number) + 1;
      violations.push({ file: relativePath, line, text: txt });
    }
  } else if (node.type === NodeTypes.ELEMENT) {
    // Check static user-facing attributes (not :bound or v- directives)
    for (const prop of (node.props as any[]) ?? []) {
      if (
        prop.type === NodeTypes.ATTRIBUTE &&
        USER_FACING_ATTRS.has(prop.name as string) &&
        prop.value
      ) {
        const v = (prop.value.content as string).trim();
        if (PROSE.test(v) && !ALLOWED_ATTR.has(v)) {
          const line =
            baseLine + countNewlines(templateContent, prop.loc.start.offset as number) + 1;
          violations.push({ file: relativePath, line, text: `[${prop.name}] ${v}` });
        }
      }
    }
    const nextInCodeish = inCodeish || CODEISH_TAGS.has(node.tag as string);
    for (const child of (node.children as any[]) ?? []) {
      walkAst(child, templateContent, baseLine, relativePath, violations, nextInCodeish);
    }
  } else {
    // IF, FOR, IF_BRANCH, and other structural nodes — recurse preserving inCodeish
    if (node.children) {
      for (const child of node.children as any[]) {
        walkAst(child, templateContent, baseLine, relativePath, violations, inCodeish);
      }
    }
    if (node.branches) {
      for (const branch of node.branches as any[]) {
        walkAst(branch, templateContent, baseLine, relativePath, violations, inCodeish);
      }
    }
  }
}

describe('no-raw-text', () => {
  test('no untranslated raw text in .vue templates', () => {
    const vueFiles = collectVueFiles(srcDir);
    const violations: Violation[] = [];

    for (const filePath of vueFiles) {
      const raw = readFileSync(filePath, 'utf-8');
      const relativePath = relative(srcDir, filePath);
      const { descriptor } = parse(raw, { filename: filePath });
      if (!descriptor.template) continue;

      const baseLine = descriptor.template.loc.start.line - 1;
      const templateContent = descriptor.template.content;
      const ast = baseParse(templateContent);

      for (const child of ast.children) {
        walkAst(child, templateContent, baseLine, relativePath, violations, false);
      }
    }

    const message =
      violations.length === 0
        ? ''
        : `Found ${violations.length} untranslated raw text string(s):\n` +
          violations.map((v) => `  ${v.file}:${v.line} >> ${v.text}`).join('\n') +
          '\n\nFix: wrap user-facing text in t(); if this is a non-translatable identifier/brand/keycap, ' +
          'add it to ALLOWED_TEXT/ALLOWED_ATTR (or wrap it in <code>/<kbd>) with a justifying comment.';

    expect(violations, message).toHaveLength(0);
  });
});
