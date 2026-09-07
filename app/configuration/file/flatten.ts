/**
 * Flatten a parsed `drydock.yml` document into the same `DD_`-prefixed,
 * uppercase, underscore-joined env var shape `get()` in `../index.ts` already
 * reads. `registry.ghcr.private.token` becomes `DD_REGISTRY_GHCR_PRIVATE_TOKEN`,
 * exactly the inverse of what `get()` does to a matching env var name.
 *
 * This module is intentionally free of any dependency on `../index.ts`: the
 * loader that calls it runs inside that module's own top-level await, so an
 * import back into `../index.ts` would be circular. `VAR_FILE_SUFFIX` below is
 * a deliberate duplicate of the constant of the same name in `../index.ts`,
 * for the same reason `../index.ts` already duplicates `ACTION_TRIGGER_ENV_TYPES`
 * rather than importing it: this is one of the lowest-level modules loaded
 * during startup.
 */

// Mirrors `VAR_FILE_SUFFIX` in `../index.ts`. Keep the two in sync by hand;
// see the module doc comment above for why this isn't a shared import.
const VAR_FILE_SUFFIX = '__FILE';

const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_]+$/;
const RESERVED_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const FILE_MARKER_KEY = '_file';

interface FlattenEntry {
  key: string;
  value: string;
  yamlPath: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Every call site passes a path that already includes the key being
// described, so this is never called with an empty array — the one caller
// that operates on the tree root (flattenConfigTree's mapping check) uses a
// literal message instead, since there's no key to name.
function describePath(pathSegments: string[]): string {
  return pathSegments.join('.');
}

function validateKeySegment(rawKey: string, pathSegments: string[]): void {
  if (!KEY_SEGMENT_PATTERN.test(rawKey)) {
    throw new Error(
      `${describePath(pathSegments)}: key "${rawKey}" must match ^[A-Za-z0-9_]+$ ` +
        '(no punctuation, since no DD_ variable can contain one)',
    );
  }
  if (RESERVED_KEY_SEGMENTS.has(rawKey.toLowerCase())) {
    throw new Error(`${describePath(pathSegments)}: "${rawKey}" is a reserved key name`);
  }
}

function toEnvKey(pathSegments: string[], suffix = ''): string {
  return `DD_${pathSegments.map((segment) => segment.toUpperCase()).join('_')}${suffix}`;
}

/**
 * A mapping's keys, lowercased, so `_file` is matched case-insensitively the
 * same way every other key is. Returns the mapping's *original* key spelling
 * for the `_file` marker if present, so error messages and the entry pushed
 * for it can use exactly what the operator wrote.
 */
function findFileMarkerKey(node: Record<string, unknown>): string | undefined {
  return Object.keys(node).find((rawKey) => rawKey.toLowerCase() === FILE_MARKER_KEY);
}

function coerceScalar(value: string | number | boolean, pathSegments: string[]): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${describePath(pathSegments)}: unsupported value type`);
}

function processFileMarkerNode(
  node: Record<string, unknown>,
  fileMarkerKey: string,
  pathSegments: string[],
  entries: FlattenEntry[],
): void {
  const otherKeys = Object.keys(node).filter((rawKey) => rawKey !== fileMarkerKey);
  if (otherKeys.length > 0) {
    throw new Error(
      `${describePath(pathSegments)}: a "_file" mapping must contain "_file" and nothing else ` +
        `(found: ${otherKeys.join(', ')})`,
    );
  }

  const fileValue = node[fileMarkerKey];
  if (typeof fileValue !== 'string' || fileValue.trim() === '') {
    throw new Error(
      `${describePath([...pathSegments, fileMarkerKey])}: must be a non-empty string`,
    );
  }

  entries.push({
    key: toEnvKey(pathSegments, VAR_FILE_SUFFIX),
    value: fileValue,
    yamlPath: describePath([...pathSegments, fileMarkerKey]),
  });
}

function processValue(value: unknown, pathSegments: string[], entries: FlattenEntry[]): void {
  if (Array.isArray(value)) {
    throw new Error(
      `${describePath(pathSegments)}: sequence values are not supported ` +
        '(list-shaped settings are comma-delimited strings, owned by their existing parsers)',
    );
  }

  if (isPlainObject(value)) {
    const fileMarkerKey = findFileMarkerKey(value);
    if (fileMarkerKey !== undefined) {
      processFileMarkerNode(value, fileMarkerKey, pathSegments, entries);
      return;
    }
    walkMapping(value, pathSegments, entries);
    return;
  }

  if (value === null) {
    // A null value means "unset" in the file layer, not "set to empty" — the
    // key is simply omitted so the environment or the Joi default can win.
    return;
  }

  const key = toEnvKey(pathSegments);
  if (key.endsWith(VAR_FILE_SUFFIX)) {
    throw new Error(
      `${describePath(pathSegments)}: flattens to ${key}, but the "${VAR_FILE_SUFFIX}" suffix ` +
        'is reserved for a "_file" mapping (e.g. `{ _file: /run/secrets/x }`), not a scalar value',
    );
  }

  const coerced = coerceScalar(value as string | number | boolean, pathSegments);
  entries.push({
    key,
    value: coerced,
    yamlPath: describePath(pathSegments),
  });
}

function walkMapping(
  node: Record<string, unknown>,
  pathSegments: string[],
  entries: FlattenEntry[],
): void {
  for (const rawKey of Object.keys(node)) {
    const childPathSegments = [...pathSegments, rawKey];
    validateKeySegment(rawKey, childPathSegments);
    processValue(node[rawKey], childPathSegments, entries);
  }
}

/**
 * Collapse the flattened entry list into the final `DD_*` map, applying the
 * one hardening rule that can only be checked once every entry is known: a
 * `_file` node's flattened key (`..._X__FILE`) must not collide with another
 * path in the *same file* that sets the base key (`..._X`) directly. The
 * env-vs-file case is not an error — that's ordinary precedence, resolved by
 * the merge step in `../index.ts` dropping the `__FILE` key the same as any
 * other file key the environment already covers.
 *
 * An ordinary collision between two differently-shaped paths that flatten to
 * the same non-secret key (the underscore/nesting ambiguity documented in the
 * spec) is not an error: the file mirrors the same ambiguity `get()` already
 * has for env vars, and the later entry wins, deterministically, in document
 * order.
 */
function buildFlattenedMap(entries: FlattenEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  const yamlPathByKey: Record<string, string> = {};

  for (const entry of entries) {
    result[entry.key] = entry.value;
    yamlPathByKey[entry.key] = entry.yamlPath;
  }

  for (const key of Object.keys(result)) {
    if (!key.endsWith(VAR_FILE_SUFFIX)) {
      continue;
    }
    const baseKey = key.slice(0, -VAR_FILE_SUFFIX.length);
    if (Object.hasOwn(result, baseKey)) {
      throw new Error(
        `${yamlPathByKey[key]} sets ${key} as a secret file, but ${yamlPathByKey[baseKey]} ` +
          `also sets ${baseKey} directly; a value cannot be both`,
      );
    }
  }

  return result;
}

/**
 * Flatten a parsed YAML document (the result of `yaml.parse()`) into a
 * `DD_*` env var map. Throws on anything the loader's parse hardening didn't
 * already reject: a non-mapping root, an invalid key, a sequence value, a
 * malformed `_file` node, or a `_file`/base-key collision.
 */
export function flattenConfigTree(tree: unknown): Record<string, string> {
  if (!isPlainObject(tree)) {
    throw new Error('the document root must be a mapping');
  }

  const entries: FlattenEntry[] = [];
  walkMapping(tree, [], entries);
  return buildFlattenedMap(entries);
}
