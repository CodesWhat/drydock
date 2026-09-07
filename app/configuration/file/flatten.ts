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

/**
 * `DD_*` env vars that 21 non-test files read straight from the real
 * environment, bypassing `ddEnvVars`/`get()` entirely — see the "direct
 * (the real environment's) DD_ readers" test in `../index.test.ts`, which
 * enumerates those 21 files and is the source of truth this list is derived
 * from (same 65 read sites,
 * minus the DD_SELF_UPDATE_* ones below). The file layer only ever reaches
 * `ddEnvVars`, so a file-only value for one of these keys would be merged
 * in and then silently never consumed by the code that actually reads it —
 * e.g. a file-only `agent.secret` would leave `agent/api/index.ts` still
 * asking for `DD_AGENT_SECRET`. Rejecting it at flatten time turns that
 * silent no-op into a load-time error naming the YAML path.
 *
 * `DD_SELF_UPDATE_*` is deliberately excluded even though those files are
 * among the 21: every `DD_SELF_UPDATE_*` variable is a handoff value the
 * app writes itself as environment for a helper container it spawns
 * (`SelfUpdateTransitionShared.ts` and `self-update-controller.ts`'s own
 * `-e` argument lists), never something an operator configures. Rejecting
 * them from `drydock.yml` would be describing a mechanism that isn't
 * configuration at all.
 *
 * Keep this in sync with the 21-file list by hand; `../index.test.ts`'s
 * recompute test fails loudly if the two drift.
 */
export const UNSUPPORTED_FILE_KEYS: readonly string[] = [
  'DD_AGENT_ALLOW_INSECURE_SECRET',
  'DD_AGENT_SECRET',
  'DD_AGENT_SECRET_FILE',
  'DD_ALLOW_INSECURE_ROOT',
  'DD_ANONYMOUS_AUTH_CONFIRM',
  'DD_AUTH_ANONYMOUS_CONFIRM',
  'DD_CONTAINERS_QUERY_CACHE_MAX_ENTRIES',
  'DD_DEFAULT_CACHE_MAX_ENTRIES',
  'DD_EVENT_HANDLER_TIMEOUT_MS',
  'DD_GHCR_VERSIONS_MAX_PAGES',
  'DD_HOOKS_ALLOWED_COMMANDS',
  'DD_HOOKS_ENABLED',
  'DD_ICON_CACHE_ENFORCEMENT_INTERVAL_MS',
  'DD_ICON_CACHE_MAX_BYTES',
  'DD_ICON_CACHE_MAX_FILES',
  'DD_ICON_CACHE_TTL_MS',
  'DD_ICON_IN_FLIGHT_TIMEOUT_MS',
  'DD_ICON_PROXY_RATE_LIMIT_MAX',
  'DD_ICON_PROXY_RATE_LIMIT_WINDOW_MS',
  'DD_OUTBOUND_HTTP_TIMEOUT_MS',
  'DD_RUN_AS_ROOT',
  'DD_SECURITY_SCAN_DIGEST_CACHE_MAX_ENTRIES',
  'DD_SECURITY_STATE_CACHE_MAX_ENTRIES',
  'DD_SECURITY_STATE_CACHE_TTL_MS',
  'DD_SSE_DEBUG_LOG_IP',
  'DD_SSE_MAX_CLIENTS',
  'DD_STATS_HISTORY_SIZE',
  'DD_STATS_INTERVAL',
  'DD_UI_MATURITY_THRESHOLD_DAYS',
  'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS',
  'DD_UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES',
  'DD_UPDATE_LIFECYCLE_CACHE_TTL_MS',
  'DD_UPDATE_MAX_CONCURRENT',
  'DD_UPDATE_OPERATION_ACTIVE_TTL_MS',
  'DD_UPDATE_OPERATION_MAX_ENTRIES',
  'DD_UPDATE_OPERATION_RETENTION_DAYS',
  'DD_UPDATE_POLICY_RETENTION_CACHE_MAX_ENTRIES',
  'DD_UPDATE_POLICY_RETENTION_CACHE_TTL_MS',
  'DD_UPDATE_POST_START_LIVENESS_GRACE_MS',
  'DD_UPDATE_RECOVERY_BOOT_CONCURRENCY',
].sort();

const UNSUPPORTED_FILE_KEYS_SET = new Set(UNSUPPORTED_FILE_KEYS);

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
 * Collapse the flattened entry list into the final `DD_*` map, applying two
 * hardening rules that can only be checked once every entry is known.
 *
 * First: no flattened key (or its `_file`-node `..._X__FILE` form) may name
 * a variable in `UNSUPPORTED_FILE_KEYS` — one of the real environment's
 * direct `DD_*` readers this file layer can never reach.
 *
 * Second: a `_file` node's flattened key (`..._X__FILE`) must not collide
 * with another path in the *same file* that sets the base key (`..._X`)
 * directly. The env-vs-file case is not an error — that's ordinary
 * precedence, resolved by the merge step in `../index.ts` dropping the
 * `__FILE` key the same as any other file key the environment already
 * covers.
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
    // A "_file" node's key carries the __FILE suffix, so check the same
    // base key an ordinary scalar for this setting would produce — a
    // secret-file pointer is exactly as unsupported here as a literal value.
    const baseKey = key.endsWith(VAR_FILE_SUFFIX) ? key.slice(0, -VAR_FILE_SUFFIX.length) : key;
    if (UNSUPPORTED_FILE_KEYS_SET.has(baseKey)) {
      throw new Error(
        `${yamlPathByKey[key]}: ${baseKey} is only read from the environment in this release, ` +
          'not from a config file; set it as an environment variable instead',
      );
    }
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
