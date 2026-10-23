/**
 * Raw-text gate for user-facing strings. Three scans:
 *
 *   1. SFC template TEXT nodes and static user-facing attributes (title, placeholder, alt,
 *      aria-label, label) with prose in them.
 *   2. Literals inside template expressions: every string literal that can reach the output of
 *      a `{{ }}` interpolation, v-text, v-tooltip, or a user-facing bound attribute
 *      (`:title`, `:aria-label`, `:placeholder`, `:label`, `:message`, ...), including branches
 *      of ternaries and `||`/`??`/`+` fallbacks. Operands of comparisons, call arguments,
 *      index accesses and t()/te() keys are not reachable output and are ignored.
 *      Thrown Error messages are developer diagnostics and are deliberately not scanned.
 *      The sanctioned t-less fallbacks `t ? t('k') : 'English'` and `t?.('k') ?? 'English'`
 *      are not flagged: the literal is for callers that pass no translate function.
 *   3. Literals in <script> blocks and src/**\/*.ts that flow into a user-visible sink: an
 *      argument of a toast/dialog call (SINK_CALLS) or the value of an object property named
 *      like user-facing copy (SINK_PROPS: title, message, label, caption, ...), again through
 *      ternary/fallback branches.
 *
 * A literal is "prose" when it has a run of 2+ letters. Anything else (numbers, symbols) passes.
 *
 * ALLOWLIST MECHANISM (add an entry only with a reason; prefer extracting to a locale key):
 *   - ALLOWED_TEXT / ALLOWED_ATTR: exact static text or attribute values (scan 1).
 *   - ALLOWED_LITERALS: exact literal -> reason, matched anywhere in scans 2 and 3. Use for
 *     brand names, units, format identifiers, keycaps.
 *   - ALLOWED_FILES: whole file -> reason, for tables of proper nouns (fonts, palettes, locales).
 *   - ALLOWED_IN_FILE: `<relative path>::<literal>` -> reason, for a literal that is only
 *     non-user-facing in one place (e.g. an id passed through a `label` property).
 *   Stale entries fail the suite, so the lists cannot rot.
 *
 * Reference: #329.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseParse, NodeTypes } from '@vue/compiler-core';
import { parse } from '@vue/compiler-sfc';
import ts from 'typescript';

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

// ---------------------------------------------------------------------------------------------
// Scans 2 and 3: literals in template expressions and script code
// ---------------------------------------------------------------------------------------------

// Calls whose arguments are shown to the user.
const SINK_CALLS = new Set(['addToast', 'toast', 'showToast']);

// Helpers that take a user-visible fallback message; the argument at the given index is a sink.
const SINK_FALLBACK_ARGS = new Map<string, number>([['errorMessage', 1]]);

// Object property names whose values are shown to the user.
const SINK_PROPS = new Set([
  'title',
  'body',
  'message',
  'label',
  'caption',
  'description',
  'placeholder',
  'ariaLabel',
  'tooltip',
  'text',
  'detail',
  'summary',
  'heading',
  'hint',
  'header',
  'subtitle',
  'acceptLabel',
  'rejectLabel',
  'emptyMessage',
  'emptyText',
]);

// Bound attribute / prop names whose expression result is shown to the user.
const SINK_BIND =
  /^(title|placeholder|alt|aria-(label|description|placeholder|roledescription|valuetext)|label|tooltip|message|description|caption|text|header|heading|subtitle|hint|summary|detail|body|empty-.+|.+-(label|title|text|message|description|placeholder|caption|hint))$/;

// Literal -> reason. Matches anywhere in scans 2 and 3.
const ALLOWED_LITERALS = new Map<string, string>([
  // Brand / protocol / product names: proper nouns, identical in every locale.
  ...['Slack', 'Discord', 'SMTP', 'HTTP', 'Telegram', 'MQTT', 'Docker', 'Compose'].map(
    (n): [string, string] => [n, 'trigger provider name (proper noun)'],
  ),
  ...['Hub', 'GHCR', 'Quay', 'ECR', 'GitLab', 'Dockerhub'].map((n): [string, string] => [
    n,
    'registry provider name (proper noun)',
  ]),
]);

// '<relative path>::<literal>' -> reason, for a literal that is non-user-facing only in that file.
function inFile(file: string, literals: string[], reason: string): [string, string][] {
  return literals.map((l) => [`${file}::${l}`, reason]);
}

const ALLOWED_IN_FILE = new Map<string, string>([
  ...inFile(
    'composables/useColumnVisibility.ts',
    [
      'Container',
      'Tag',
      'Software Version',
      'Update',
      'Status',
      'Host',
      'Registry',
      'Resources',
      'Uptime',
      'Ports',
    ],
    'English fallback beside labelKey; every consumer renders t(column.labelKey) when present',
  ),
  ...inFile(
    'composables/useLogViewerBehavior.ts',
    ['Off'],
    'LOG_AUTO_FETCH_INTERVALS is passed into the template context but no template renders it',
  ),
  ...inFile(
    'components/config/ConfigLogsTab.vue',
    ['info'],
    'log level fallback rendered uppercase next to server-supplied levels, which are never translated',
  ),
  ...inFile(
    'types/update-operation.ts',
    ['Cancelled by operator'],
    'backend sentinel compared against the error text, never rendered as-is',
  ),
  ...inFile(
    'utils/error.ts',
    ['No update available for this container'],
    'backend error text matched verbatim, never rendered',
  ),
  ...inFile(
    'utils/container-mapper.ts',
    ['Local'],
    'server identity key used for filtering and grouping (persisted filterServer), not a label',
  ),
  ...inFile(
    'views/WatchersView.vue',
    ['Local'],
    'server identity key passed as filterServer; must equal container.server',
  ),
  ...inFile(
    'views/dashboard/useDashboardComputed.ts',
    ['Local'],
    'server identity key joined against container.server, not a label',
  ),
  ...inFile(
    'views/dashboard/useDashboardData.ts',
    ['Dashboard background refresh failed'],
    'console.debug only, never shown',
  ),
  ...inFile(
    'components/LabelOverridesPanel.vue',
    ['info'],
    'tone name for a source badge, not text',
  ),
  ...inFile(
    'components/containers/ContainerMaturityPolicyEditor.vue',
    [
      'groupPolicyEditor.editor.minAge',
      'containerComponents.fullPageActions.skipReleases',
      'containerComponents.fullPageActions.releaseFallbackDays',
    ],
    'i18n keys, rendered through t(field.label)',
  ),
  ...inFile(
    'services/totp-factor.ts',
    ['Two-factor request failed ('],
    'TotpRequestError message is never rendered; the composable maps the status to a translated error kind',
  ),
  ...inFile(
    'views/images/imagesViewHelpers.ts',
    ['Local'],
    'capitalised name of the built-in local watcher, matching the watcher name and server identity key',
  ),
]);

// Files whose literals are all proper nouns or deliberately native-language names.
const ALLOWED_FILES = new Map<string, string>([
  ['i18n/locales.ts', 'language names are shown in their own language by design'],
  ['theme/palettes.ts', 'theme names are proper nouns (One Dark, Dracula, ...)'],
  ['composables/useFont.ts', 'font family names are proper nouns'],
]);

const usedAllowlistEntries = new Set<string>();

// CSS values and JSON keywords that carry no prose even though they contain letters.
const NON_PROSE_VALUE = /^(var\(|rgba?\(|hsla?\(|#[0-9a-f]{3,8}$|transparent$|true$|false$|null$)/i;

function isProse(text: string): boolean {
  const t = text.trim();
  return PROSE.test(t) && !NON_PROSE_VALUE.test(t);
}

// Weak sinks (return values, initializers) are everywhere in code and mostly
// carry identifiers, so only sentence-like text counts: two or more words, or a Capitalized word.
function isSentenceLike(text: string): boolean {
  const t = text.trim();
  if (/^\p{Lu}\p{Ll}{2,}/u.test(t)) return true;
  // Lowercase multi-word text, minus class lists / paths (hyphens, brackets, digits, slashes).
  return /\p{L}{2,}\s+\p{L}{2,}/u.test(t) && !/[-[\]\d/\\]/.test(t);
}

type Strength = 'strong' | 'weak';

function literalAllowed(rel: string, text: string): boolean {
  const trimmed = text.trim();
  if (ALLOWED_FILES.has(rel)) {
    usedAllowlistEntries.add(`A::${rel}`);
    return true;
  }
  if (ALLOWED_LITERALS.has(trimmed)) {
    usedAllowlistEntries.add(`L::${trimmed}`);
    return true;
  }
  const fileKey = `${rel}::${trimmed}`;
  if (ALLOWED_IN_FILE.has(fileKey)) {
    usedAllowlistEntries.add(`F::${fileKey}`);
    return true;
  }
  return false;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

const TRANSLATE_FNS = new Set(['t', '$t', 'te', 'translate']);

/** `t(...)`, `i18n.t(...)`, `options.t?.(...)`: a call whose result is already translated. */
function isTranslateCall(node: ts.Node): boolean {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return ts.isCallExpression(n) && TRANSLATE_FNS.has(calleeName(n) ?? '');
}

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/**
 * Does the value of `node` flow, unchanged in meaning, into `isSinkParent`? Climbs through
 * ternary branches, `||`/`??`/`&&`/`+` operands, parentheses, `as` casts and template spans.
 * Stops (returns false) at comparisons, calls, element access and anything else.
 */
function flowsToSink(node: ts.Node, rootIsSink: boolean, rootNode?: ts.Node): Strength | false {
  let cur: ts.Node = node;
  for (;;) {
    if (rootNode && cur === rootNode) return rootIsSink ? 'strong' : false;
    const parent = cur.parent;
    if (!parent) return rootIsSink ? 'strong' : false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
      cur = parent;
    } else if (ts.isNonNullExpression(parent) || ts.isTemplateSpan(parent)) {
      cur = parent;
    } else if (ts.isTemplateExpression(parent)) {
      cur = parent;
    } else if (ts.isConditionalExpression(parent)) {
      if (parent.condition === cur) return false;
      // `t ? t('key') : 'English'` is the sanctioned t-less fallback idiom: the literal is the
      // fallback for callers that supply no translate function, not the UI copy.
      if (parent.whenFalse === cur && isTranslateCall(parent.whenTrue)) return false;
      cur = parent;
    } else if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      const passes =
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.PlusToken;
      if (!passes) return false;
      // `t?.('key') ?? 'English'`: same sanctioned fallback idiom.
      const isFallbackOp =
        op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
      if (isFallbackOp && parent.right === cur && isTranslateCall(parent.left)) return false;
      cur = parent;
    } else if (ts.isPropertyAssignment(parent) && parent.initializer === cur) {
      const name = propName(parent.name);
      return name !== undefined && SINK_PROPS.has(name) ? 'strong' : false;
    } else if (ts.isCallExpression(parent)) {
      const name = calleeName(parent);
      if (name === undefined) return false;
      const idx = parent.arguments.indexOf(cur as never);
      if (idx < 0) return false;
      if (SINK_CALLS.has(name)) return 'strong';
      return SINK_FALLBACK_ARGS.get(name) === idx ? 'strong' : false;
    } else if (
      ts.isReturnStatement(parent) ||
      (ts.isVariableDeclaration(parent) && parent.initializer === cur) ||
      (ts.isArrowFunction(parent) && parent.body === cur)
    ) {
      return 'weak';
    } else if (ts.isExpressionStatement(parent) || ts.isSourceFile(parent)) {
      return rootIsSink ? 'strong' : false;
    } else {
      return false;
    }
  }
}

interface LiteralHit {
  text: string;
  node: ts.Node;
}

/** Every string literal / template text chunk with prose, whose flow reaches a sink. */
function findSinkLiterals(
  sf: ts.SourceFile,
  rootIsSink: boolean,
  rootNode?: ts.Node,
): LiteralHit[] {
  const hits: LiteralHit[] = [];
  const visit = (node: ts.Node) => {
    let text: string | undefined;
    let anchor: ts.Node = node;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
      // Skip import/export specifiers, type literals and JSX-ish noise
      if (
        ts.isImportDeclaration(node.parent) ||
        ts.isExportDeclaration(node.parent) ||
        ts.isLiteralTypeNode(node.parent) ||
        ts.isExternalModuleReference(node.parent)
      ) {
        text = undefined;
      }
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text;
      anchor = node.parent; // TemplateExpression or TemplateSpan
      if (ts.isTemplateSpan(anchor)) anchor = anchor.parent;
    }
    const strength =
      text !== undefined && isProse(text) ? flowsToSink(anchor, rootIsSink, rootNode) : false;
    if (text !== undefined && strength && (strength === 'strong' || isSentenceLike(text))) {
      hits.push({ text: text.trim().replace(/\s+/g, ' '), node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function lineOfPos(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
}

function parseScript(code: string): ts.SourceFile {
  return ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function parseExpression(expr: string): ts.SourceFile {
  return parseScript(`(${expr});`);
}

function collectFiles(dir: string, exts: RegExp): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === join(srcDir, 'locales')) continue;
      results.push(...collectFiles(fullPath, exts));
    } else if (entry.isFile() && exts.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scanTemplateExpressions(node: any, baseLine: number, rel: string, out: Violation[]): void {
  const check = (expr: string, offset: number, rootIsSink: boolean, asStatements: boolean) => {
    const sf = asStatements ? parseScript(expr) : parseExpression(expr);
    const hits = findSinkLiterals(sf, rootIsSink, asStatements ? undefined : undefined);
    for (const h of hits) {
      if (literalAllowed(rel, h.text)) continue;
      out.push({
        file: rel,
        line: baseLine + offset + lineOfPos(sf, h.node) + 1,
        text: `[template] ${h.text}`,
      });
    }
  };

  if (node.type === NodeTypes.INTERPOLATION) {
    const content = node.content;
    if (content?.content) {
      check(content.content as string, (content.loc.start.line as number) - 1, true, false);
    }
    return;
  }
  if (node.type === NodeTypes.ELEMENT) {
    for (const prop of (node.props as any[]) ?? []) {
      if (prop.type !== NodeTypes.DIRECTIVE || !prop.exp?.content) continue;
      const dir = prop.name as string;
      const arg = prop.arg?.isStatic ? (prop.arg.content as string) : undefined;
      const offset = (prop.exp.loc.start.line as number) - 1;
      const exp = prop.exp.content as string;
      if (dir === 'text' || dir === 'tooltip') {
        check(exp, offset, true, false);
      } else if (dir === 'bind' && arg && SINK_BIND.test(arg)) {
        check(exp, offset, true, false);
      } else if (dir === 'on') {
        check(exp, offset, false, true);
      } else if (dir === 'bind' || dir === 'if' || dir === 'else-if' || dir === 'show') {
        check(exp, offset, false, false);
      }
    }
  }
  for (const child of (node.children as any[]) ?? []) {
    scanTemplateExpressions(child, baseLine, rel, out);
  }
  for (const branch of (node.branches as any[]) ?? []) {
    scanTemplateExpressions(branch, baseLine, rel, out);
  }
}

function scanScript(code: string, baseLine: number, rel: string, out: Violation[]): void {
  const sf = parseScript(code);
  for (const h of findSinkLiterals(sf, false)) {
    if (literalAllowed(rel, h.text)) continue;
    out.push({ file: rel, line: baseLine + lineOfPos(sf, h.node) + 1, text: `[script] ${h.text}` });
  }
}

function formatViolations(violations: Violation[]): string {
  return violations.length === 0
    ? ''
    : `Found ${violations.length} untranslated user-facing literal(s):\n` +
        violations.map((v) => `  ${v.file}:${v.line} >> ${v.text}`).join('\n') +
        '\n\nFix: move the string to src/locales/<lang>/*.json and use t(). If it is not user-facing ' +
        '(id, class, unit, brand), add it to ALLOWED_LITERALS / ALLOWED_IN_FILE with a reason.';
}

describe('no-raw-text: scanner self-check', () => {
  const scan = (code: string): string[] => {
    const out: Violation[] = [];
    scanScript(code, 0, 'fixture.ts', out);
    return out.map((v) => v.text);
  };
  const scanTpl = (tpl: string): string[] => {
    const out: Violation[] = [];
    for (const child of baseParse(tpl).children) {
      scanTemplateExpressions(child, 0, 'fixture.vue', out);
    }
    return out.map((v) => v.text);
  };

  test('flags literals that reach toast, dialog and label sinks', () => {
    expect(scan("addToast('Saved it');")).toEqual(['[script] Saved it']);
    expect(scan("const o = { title: ok ? 'Yes it is' : t('k') };")).toEqual(['[script] Yes it is']);
    expect(scan('const o = { message: `Failed: ${x}` };')).toEqual(['[script] Failed:']);
    expect(scan("function f() { return 'Something broke'; }")).toEqual([
      '[script] Something broke',
    ]);
  });

  test('ignores identifiers, comparisons, keys and the t-less fallback idiom', () => {
    expect(scan("const o = { tone: 'danger', label: t('k') };")).toEqual([]);
    expect(scan("if (x === 'Some Value') {}")).toEqual([]);
    expect(scan("const l = t ? t('k') : 'English fallback';")).toEqual([]);
    expect(scan("const l = o.t?.('k') ?? 'English fallback';")).toEqual([]);
    expect(scan("const c = { color: 'var(--dd-danger)', label: 'true' };")).toEqual([]);
    expect(scan("const cls = 'flex flex-col gap-3';")).toEqual([]);
  });

  test('flags literals in interpolations and user-facing bindings only', () => {
    expect(scanTpl("<p>{{ ok ? 'yes' : 'no' }}</p>")).toEqual(['[template] yes', '[template] no']);
    expect(scanTpl("<p>{{ x || 'Nothing here' }}</p>")).toEqual(['[template] Nothing here']);
    expect(scanTpl("<p>{{ t('a.b') }} {{ x === 'ready' ? t('c.d') : t('e.f') }}</p>")).toEqual([]);
    expect(
      scanTpl(`<i :title="'Hello there'" :aria-haspopup="'listbox'" :class="'flex gap-2'" />`),
    ).toEqual(['[template] Hello there']);
    expect(
      scanTpl(`<i v-tooltip="ok ? 'Tip text' : undefined" @click="addToast('Done now')" />`),
    ).toEqual(['[template] Tip text', '[template] Done now']);
  });
});

describe('no-raw-text: literals in template expressions and scripts', () => {
  const violations: Violation[] = [];
  const files = collectFiles(srcDir, /\.(vue|ts)$/);

  for (const filePath of files) {
    const raw = readFileSync(filePath, 'utf-8');
    const rel = relative(srcDir, filePath);
    if (filePath.endsWith('.ts')) {
      scanScript(raw, 0, rel, violations);
      continue;
    }
    const { descriptor } = parse(raw, { filename: filePath });
    if (descriptor.template) {
      const baseLine = descriptor.template.loc.start.line - 1;
      const ast = baseParse(descriptor.template.content);
      for (const child of ast.children) {
        scanTemplateExpressions(child, baseLine, rel, violations);
      }
    }
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block) scanScript(block.content, block.loc.start.line - 1, rel, violations);
    }
  }

  test('no untranslated literals reach user-visible output', () => {
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  test('allowlist entries are all still needed', () => {
    const stale = [
      ...[...ALLOWED_LITERALS.keys()].filter((k) => !usedAllowlistEntries.has(`L::${k}`)),
      ...[...ALLOWED_FILES.keys()].filter((k) => !usedAllowlistEntries.has(`A::${k}`)),
      ...[...ALLOWED_IN_FILE.keys()].filter((k) => !usedAllowlistEntries.has(`F::${k}`)),
    ];
    expect(stale, `Stale allowlist entries:\n${stale.join('\n')}`).toHaveLength(0);
  });
});
