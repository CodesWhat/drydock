/**
 * Used-key gate: every i18n key referenced in ui/src must exist in the en locale files.
 *
 * What counts as a reference (scanned in .vue and .ts, tests excluded):
 *   - any string literal whose value starts with a locale namespace (the file name of an
 *     en/*.json, e.g. 'configView.general.title'), whether it is passed to t()/$t()/te()/
 *     i18n.global.t(), a keypath="..." prop, or stored in data (labelKey: 'appShell.x').
 *     Matching on the namespace root instead of the call shape means indirection through
 *     helpers and option arrays is covered too.
 *   - template literals with a `${...}` hole, e.g. t(`dashboardView.updateKind.${kind}`).
 *     The static prefix must resolve to an object in en. If text follows the hole
 *     (`...options.${id}.label`), every child of the prefix object must have that suffix.
 *
 * Allowlist mechanism:
 *   - IGNORED_KEYS: exact strings that look like keys but are not (each with a reason).
 *   - DYNAMIC_PREFIX_ALLOWLIST: dynamic prefixes whose children are not uniformly shaped; the
 *     value is the enumerated list of full suffixes that must exist under the prefix.
 *   Add an entry only with a reason comment; prefer fixing the locale file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const enDir = join(srcDir, 'locales/en');

// Exact literals that start with a namespace but are not i18n keys. Reason required.
const IGNORED_KEYS = new Map<string, string>([]);

// Dynamic prefix -> explicit list of suffixes that must exist (used when children differ in shape).
const DYNAMIC_PREFIX_ALLOWLIST = new Map<string, string[]>([
  // Sibling keys of different shapes share the prefix; only these suffixes are ever built.
  ['actionEditor', ['orderHelp', 'concurrencyHelp']],
  [
    'watcherEditor',
    [
      'fileUnavailable',
      'watcherUnavailable',
      'accessDenied',
      'recoveryAssurance',
      'apiUnavailable',
      'rateLimited',
      'loadFailed',
      'saveUncertain',
    ],
  ],
  ['groupPolicyEditor', ['saved', 'removed']],
]);

type Tree = Record<string, unknown>;

function loadEn(): Tree {
  const merged: Tree = {};
  for (const f of readdirSync(enDir).filter((n) => n.endsWith('.json'))) {
    Object.assign(merged, JSON.parse(readFileSync(join(enDir, f), 'utf-8')));
  }
  return merged;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p === join(srcDir, 'locales')) continue;
      out.push(...walk(p));
    } else if (/\.(vue|ts)$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function resolvePath(tree: Tree, path: string): unknown {
  let cur: unknown = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in (cur as Tree))) return undefined;
    cur = (cur as Tree)[part];
  }
  return cur;
}

const en = loadEn();
const namespaces = Object.keys(en);
const nsAlt = namespaces.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
// 'ns.a.b' or "ns.a.b" (static)
const STATIC = new RegExp(`(['"])((?:${nsAlt})(?:\\.[A-Za-z0-9_-]+)+)\\1`, 'g');
// `ns.a.${x}.b` (template literal with at least one hole)
const TEMPLATE = new RegExp(`\`((?:${nsAlt})\\.[^\`]*\\$\\{[^\`]*)\``, 'g');

interface Ref {
  file: string;
  line: number;
  key: string;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function collect(): { statics: Ref[]; dynamics: Ref[] } {
  const statics: Ref[] = [];
  const dynamics: Ref[] = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf-8');
    const rel = relative(srcDir, file);
    for (const m of text.matchAll(STATIC)) {
      statics.push({ file: rel, line: lineOf(text, m.index ?? 0), key: m[2] });
    }
    for (const m of text.matchAll(TEMPLATE)) {
      dynamics.push({ file: rel, line: lineOf(text, m.index ?? 0), key: m[1] });
    }
  }
  return { statics, dynamics };
}

describe('used i18n keys exist in en', () => {
  const { statics, dynamics } = collect();

  test('scanner finds references (guards against a silently empty scan)', () => {
    expect(statics.length).toBeGreaterThan(200);
    expect(dynamics.length).toBeGreaterThan(5);
  });

  test('every static key resolves to a string in en', () => {
    const missing = statics
      .filter((r) => !IGNORED_KEYS.has(r.key))
      .filter((r) => typeof resolvePath(en, r.key) !== 'string')
      .map((r) => `  ${r.file}:${r.line} >> ${r.key}`);
    expect(
      missing,
      `Keys used in source but missing from src/locales/en (or not a leaf string):\n${missing.join('\n')}`,
    ).toHaveLength(0);
  });

  test('every dynamic key prefix resolves, and every child has the trailing suffix', () => {
    const problems: string[] = [];
    for (const r of dynamics) {
      const holeAt = r.key.indexOf('${');
      const prefix = r.key.slice(0, holeAt).replace(/\.$/, '');
      const afterHole = r.key.slice(r.key.indexOf('}', holeAt) + 1);
      const suffix = afterHole.startsWith('.') ? afterHole.slice(1) : '';
      const where = `${r.file}:${r.line} >> ${r.key}`;
      const node = resolvePath(en, prefix);
      if (typeof node !== 'object' || node === null) {
        problems.push(`  ${where} (prefix '${prefix}' is not an object in en)`);
        continue;
      }
      if (suffix.includes('${')) continue; // multiple holes: prefix check only
      const enumerated = DYNAMIC_PREFIX_ALLOWLIST.get(prefix);
      if (enumerated) {
        for (const s of enumerated) {
          if (typeof resolvePath(en, `${prefix}.${s}`) !== 'string') {
            problems.push(`  ${where} (allowlisted suffix '${s}' missing)`);
          }
        }
        continue;
      }
      const children = Object.keys(node as Tree);
      if (children.length === 0) problems.push(`  ${where} (prefix object is empty)`);
      if (suffix) {
        for (const c of children) {
          if (typeof resolvePath(node as Tree, `${c}.${suffix}`) !== 'string') {
            problems.push(`  ${where} (child '${c}' lacks '${suffix}')`);
          }
        }
      } else if (children.some((c) => typeof (node as Tree)[c] !== 'string')) {
        problems.push(`  ${where} (prefix has non-string children)`);
      }
    }
    expect(problems, `Dynamic i18n keys that cannot resolve:\n${problems.join('\n')}`).toHaveLength(
      0,
    );
  });
});
