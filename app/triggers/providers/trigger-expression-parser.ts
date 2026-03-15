import logger from '../../log/index.js';
import type { Container } from '../../model/container.js';

const log = logger.child({ component: 'trigger-expression-parser' });
const warnedLegacyTemplateVars = new Set<string>();
const LEGACY_SIMPLE_VARS = ['id', 'name', 'watcher', 'kind', 'semver', 'local', 'remote', 'link'];
const LEGACY_BATCH_VARS = ['count'];

type TemplateVars = Record<string, unknown>;

/**
 * Safely resolve a dotted property path on an object.
 * Returns undefined when any segment along the path is nullish.
 */
function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null) return undefined;
    return Reflect.get(new Object(cur), key);
  }, obj);
}

/** Simple identifier segment test -- no nested groups, linear time. */
const IDENT_RE = /^[a-zA-Z_]\w*$/;

/**
 * Validate a dotted property path (e.g. "container.updateKind.kind")
 * by splitting on '.' and checking each segment individually.
 * This avoids a regex with nested repetition that is vulnerable to ReDoS.
 */
function isValidPropertyPath(str: string): boolean {
  const parts = str.split('.');
  return parts.length > 0 && parts.every((p) => IDENT_RE.test(p));
}

/**
 * Parse a method call expression like "obj.path.method(args)" by splitting
 * on the parentheses and the last dot, rather than using a single complex regex.
 * Returns null if the string is not a valid method call expression.
 */
function parseMethodCall(str: string): { objPath: string; method: string; rawArgs: string } | null {
  if (!str.endsWith(')')) return null;
  const openParen = str.indexOf('(');
  if (openParen === -1) return null;

  const rawArgs = str.slice(openParen + 1, -1);
  if (rawArgs.includes(')')) return null;

  const pathPart = str.slice(0, openParen);
  const lastDot = pathPart.lastIndexOf('.');
  if (lastDot === -1) return null;

  const objPath = pathPart.slice(0, lastDot);
  const method = pathPart.slice(lastDot + 1);

  if (!isValidPropertyPath(objPath) || !IDENT_RE.test(method)) return null;

  return { objPath, method, rawArgs };
}

/** Allowed safe string/array methods for template expressions. */
const ALLOWED_METHODS = new Set([
  'substring',
  'slice',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
  'replace',
  'split',
  'indexOf',
  'lastIndexOf',
  'startsWith',
  'endsWith',
  'includes',
  'charAt',
  'padStart',
  'padEnd',
  'repeat',
  'toString',
]);

function evalTernary(trimmed: string, vars: TemplateVars): unknown {
  const ternaryIdx = findTopLevelOperator(trimmed, isOperator('?'));
  if (ternaryIdx === -1) return undefined;
  const condition = trimmed.slice(0, ternaryIdx);
  const rest = trimmed.slice(ternaryIdx + 1);
  const colonIdx = findTopLevelOperator(rest, isOperator(':'));
  if (colonIdx === -1) return undefined;
  const consequent = rest.slice(0, colonIdx);
  const alternate = rest.slice(colonIdx + 1);
  const condVal = safeEvalExpr(condition, vars);
  return condVal ? safeEvalExpr(consequent, vars) : safeEvalExpr(alternate, vars);
}

function evalLogicalAnd(trimmed: string, vars: TemplateVars): unknown {
  const andIdx = findTopLevelOperator(trimmed, isOperator('&&'));
  if (andIdx === -1) return undefined;
  const left = trimmed.slice(0, andIdx);
  const right = trimmed.slice(andIdx + 2);
  const leftVal = safeEvalExpr(left, vars);
  if (!leftVal) return leftVal;
  return safeEvalExpr(right, vars);
}

function toTemplateString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function evalConcat(trimmed: string, vars: TemplateVars): string | undefined {
  const plusIdx = findTopLevelOperator(trimmed, isPlusOperator);
  if (plusIdx === -1) return undefined;
  const left = trimmed.slice(0, plusIdx);
  const right = trimmed.slice(plusIdx + 1);
  return toTemplateString(safeEvalExpr(left, vars)) + toTemplateString(safeEvalExpr(right, vars));
}

function evalStringLiteral(trimmed: string): string | undefined {
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replaceAll(String.raw`\n`, '\n')
      .replaceAll(String.raw`\t`, '\t')
      .replaceAll(String.raw`\"`, '"')
      .replaceAll(String.raw`\'`, "'");
  }
  return undefined;
}

function evalNumberLiteral(trimmed: string): string | undefined {
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return String(Number(trimmed));
  }
  return undefined;
}

function evalMethodCall(trimmed: string, vars: TemplateVars): unknown {
  const methodMatch = parseMethodCall(trimmed);
  if (!methodMatch) return undefined;
  const { objPath, method, rawArgs } = methodMatch;
  const target = safeEvalExpr(objPath, vars);
  if (target == null || !ALLOWED_METHODS.has(method)) {
    return '';
  }
  const methodFn = Reflect.get(new Object(target), method);
  if (typeof methodFn !== 'function') {
    return '';
  }
  const args: unknown[] =
    rawArgs.trim() === '' ? [] : rawArgs.split(',').map((a: string) => safeEvalExpr(a, vars));
  return methodFn.apply(target, args);
}

function evalPropertyPath(trimmed: string, vars: TemplateVars): unknown {
  if (isValidPropertyPath(trimmed)) {
    const val = resolvePath(vars, trimmed);
    return val ?? '';
  }
  return undefined;
}

/**
 * Safely evaluate a template expression against a known set of variables.
 *
 * Supported expression forms (all other syntax is returned as-is):
 *   - property paths:    container.updateKind.kind
 *   - method calls:      local.substring(0, 15)
 *   - logical AND:       a && b            (returns b when both truthy)
 *   - ternary:           a ? b : c
 *   - string literals:   "hello"  or  "hello" + var
 *   - string concat:     expr + expr
 */
function safeEvalExpr(expr: string, vars: TemplateVars): unknown {
  const trimmed = expr.trim();
  const ternary = evalTernary(trimmed, vars);
  if (ternary !== undefined) return ternary;
  const logicalAnd = evalLogicalAnd(trimmed, vars);
  if (logicalAnd !== undefined) return logicalAnd;
  const concat = evalConcat(trimmed, vars);
  if (concat !== undefined) return concat;
  const stringLiteral = evalStringLiteral(trimmed);
  if (stringLiteral !== undefined) return stringLiteral;
  const numberLiteral = evalNumberLiteral(trimmed);
  if (numberLiteral !== undefined) return numberLiteral;
  const methodCall = evalMethodCall(trimmed, vars);
  if (methodCall !== undefined) return methodCall;
  const propertyPath = evalPropertyPath(trimmed, vars);
  if (propertyPath !== undefined) return propertyPath;

  return '';
}

/**
 * Predicate factory for matching a fixed operator string at position i.
 */
function isOperator(op: string): (str: string, i: number) => boolean {
  return (str, i) => str.slice(i, i + op.length) === op;
}

/**
 * Predicate for matching a top-level '+' that is not part of '++' and has
 * a non-whitespace token on the left (i.e. not a unary plus / numeric sign).
 */
function isPlusOperator(str: string, i: number): boolean {
  if (str[i] !== '+' || str[i + 1] === '+') return false;
  const left = str.slice(0, i).trim();
  return left.length > 0;
}

function isEscapeCharacter(ch: string): boolean {
  return ch === '\\';
}

function toggleQuoteState(
  ch: string,
  inDouble: boolean,
  inSingle: boolean,
): { inDouble: boolean; inSingle: boolean; didToggle: boolean } {
  if (ch === '"' && !inSingle) {
    return { inDouble: !inDouble, inSingle, didToggle: true };
  }
  if (ch === "'" && !inDouble) {
    return { inDouble, inSingle: !inSingle, didToggle: true };
  }
  return { inDouble, inSingle, didToggle: false };
}

function updateParenDepth(depth: number, ch: string): number {
  if (ch === '(') return depth + 1;
  if (ch === ')') return depth - 1;
  return depth;
}

type TopLevelOperatorScanState = {
  depth: number;
  inDouble: boolean;
  inSingle: boolean;
};

function updateQuoteStateAndCheckInsideQuote(
  ch: string,
  state: TopLevelOperatorScanState,
): boolean {
  const quoteState = toggleQuoteState(ch, state.inDouble, state.inSingle);
  state.inDouble = quoteState.inDouble;
  state.inSingle = quoteState.inSingle;
  return quoteState.didToggle || state.inDouble || state.inSingle;
}

function isTopLevelPredicateMatch(
  str: string,
  i: number,
  predicate: (str: string, i: number) => boolean,
  state: TopLevelOperatorScanState,
): boolean {
  state.depth = updateParenDepth(state.depth, str[i]);
  return state.depth === 0 && predicate(str, i);
}

function scanTopLevelOperatorStep(
  str: string,
  i: number,
  predicate: (str: string, i: number) => boolean,
  state: TopLevelOperatorScanState,
): { found: boolean; skipNext: boolean } {
  const ch = str[i];
  if (isEscapeCharacter(ch)) {
    return { found: false, skipNext: true };
  }

  if (updateQuoteStateAndCheckInsideQuote(ch, state)) {
    return { found: false, skipNext: false };
  }

  return {
    found: isTopLevelPredicateMatch(str, i, predicate, state),
    skipNext: false,
  };
}

/**
 * Find the index of a top-level operator (not inside quotes or parentheses)
 * that satisfies the given predicate.
 */
function findTopLevelOperator(str: string, predicate: (str: string, i: number) => boolean): number {
  const state: TopLevelOperatorScanState = { depth: 0, inDouble: false, inSingle: false };
  let skipNext = false;
  for (let i = 0; i < str.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const step = scanTopLevelOperatorStep(str, i, predicate, state);
    if (step.found) {
      return i;
    }
    skipNext = step.skipNext;
  }
  return -1;
}

function safeInterpolate(template: string | undefined, vars: TemplateVars): string {
  if (template == null) {
    return '';
  }
  return template.replaceAll(/\$\{([^}]+)\}/g, (_, expr) => {
    const result = safeEvalExpr(expr, vars);
    return toTemplateString(result);
  });
}

function warnLegacyTemplateVars(template: string, legacyVars: string[], replacementPrefix: string) {
  for (const varName of legacyVars) {
    if (warnedLegacyTemplateVars.has(varName)) continue;
    if (template.includes(`\${${varName}}`)) {
      warnedLegacyTemplateVars.add(varName);
      const replacement =
        varName === 'count'
          ? `\${${replacementPrefix}.length}`
          : `\${${replacementPrefix}.${varName}}`;
      log.warn(
        `Legacy trigger template variable "\${${varName}}" is deprecated and will be removed in v1.6.0. Use "${replacement}" instead.`,
      );
    }
  }
}

/**
 * Render body or title simple template.
 */
export function renderSimple(template: string, container: Container): string {
  if (template) warnLegacyTemplateVars(template, LEGACY_SIMPLE_VARS, 'container');
  const vars: TemplateVars = {
    container,
    // Deprecated vars for backward compatibility
    id: container.id,
    name: container.name,
    watcher: container.watcher,
    kind: container.updateKind?.kind ?? '',
    semver: container.updateKind?.semverDiff ?? '',
    local: container.updateKind?.localValue ?? '',
    remote: container.updateKind?.remoteValue ?? '',
    suggestedTag: container.result?.suggestedTag ?? '',
    link: container.result?.link ?? '',
  };
  return safeInterpolate(template, vars);
}

export function renderBatch(template: string, containers: Container[]): string {
  if (template) warnLegacyTemplateVars(template, LEGACY_BATCH_VARS, 'containers');
  const vars: TemplateVars = {
    containers,
    // Deprecated var for backward compatibility
    count: containers.length,
  };
  return safeInterpolate(template, vars);
}
