/**
 * Whole-scalar `${NAME}` / `${NAME:-default}` interpolation for a parsed
 * `drydock.yml` document (spec-7.1-config-file.md, decision D1, section 8.3).
 *
 * Runs as a pre-pass ahead of `flatten.ts`, on the raw parsed tree, rather
 * than being folded into flatten itself: flatten.ts stays a pure function of
 * the tree it's handed, with no environment dependency of its own, and this
 * module owns the one new dependency instead. `loader.ts` composes the two
 * in sequence: parse → interpolate → flatten.
 *
 * Only a scalar whose *entire* value matches the pattern is substituted —
 * `prefix-${X}` is left exactly as written, there is no partial
 * substitution inside a longer string. A substituted value is never
 * re-scanned, so a default or environment value that itself looks like
 * `${Y}` is not substituted again (no recursion).
 */

// Mirrors the same-named constants in `flatten.ts`. Duplicated rather than
// imported for the reason that module's own doc comment gives for its
// duplicate of `VAR_FILE_SUFFIX`: these are both lowest-level modules the
// loader composes in its own top-level await, and keeping each one free of
// the other's internals keeps them independently testable.
const VAR_FILE_SUFFIX = '__FILE';
const FILE_MARKER_KEY = '_file';

// Group 1: the variable name. Group 2: the default, when `:-` is present
// (an empty string after `:-` is a valid, deliberate empty default).
const INTERPOLATION_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?\}$/;

export interface InterpolateConfigTreeResult {
  /** The tree with every whole-scalar `${NAME}` match replaced. Never the
   * same object as the input — the input is not mutated. */
  tree: unknown;
  /** `DD_*` keys (using the same derivation flatten.ts uses) whose value
   * came from this substitution, so the loader can attribute them to the
   * `env` source rather than `file`. */
  interpolatedKeys: Set<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findFileMarkerKey(node: Record<string, unknown>): string | undefined {
  return Object.keys(node).find((rawKey) => rawKey.toLowerCase() === FILE_MARKER_KEY);
}

function toEnvKey(pathSegments: string[], suffix = ''): string {
  return `DD_${pathSegments.map((segment) => segment.toUpperCase()).join('_')}${suffix}`;
}

function describePath(pathSegments: string[]): string {
  return pathSegments.join('.');
}

/**
 * Resolve one candidate scalar against the interpolation pattern.
 * Returns `undefined` (meaning: leave the value exactly as written) when it
 * doesn't match the pattern at all. Throws when it matches but names an
 * environment variable that is unset and has no `:-default`.
 */
function resolveInterpolatedScalar(
  value: string,
  pathSegments: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  const match = INTERPOLATION_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }
  const [, varName, defaultValue] = match;
  const envValue = env[varName];
  if (envValue !== undefined) {
    return envValue;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(
    `${describePath(pathSegments)}: references environment variable "${varName}", ` +
      'which is not set and has no ":-default" fallback',
  );
}

function interpolateValue(
  value: unknown,
  pathSegments: string[],
  envKeySegments: string[],
  env: Record<string, string | undefined>,
  interpolatedKeys: Set<string>,
): unknown {
  if (typeof value === 'string') {
    const resolved = resolveInterpolatedScalar(value, pathSegments, env);
    if (resolved === undefined) {
      return value;
    }
    interpolatedKeys.add(toEnvKey(envKeySegments));
    return resolved;
  }

  if (isPlainObject(value)) {
    return interpolateMapping(value, pathSegments, envKeySegments, env, interpolatedKeys);
  }

  // Arrays, numbers, booleans and null pass through untouched: none of them
  // can equal a `${...}` pattern, and flatten.ts owns rejecting/coercing
  // every one of these shapes on its own pass.
  return value;
}

function interpolateMapping(
  node: Record<string, unknown>,
  pathSegments: string[],
  envKeySegments: string[],
  env: Record<string, string | undefined>,
  interpolatedKeys: Set<string>,
): Record<string, unknown> {
  const fileMarkerKey = findFileMarkerKey(node);
  // A Map, not a plain object built up with bracket assignment: a raw
  // `__proto__` key (present, for instance, when a `drydock.yml` mapping
  // literally has a key named "__proto__") would otherwise be read back
  // through bracket assignment as a call to Object.prototype's `__proto__`
  // setter, silently repointing the accumulator's own prototype instead of
  // creating an own property — losing the key rather than the harmless
  // string it should be. Map.set has no such setter to collide with, so the
  // key round-trips for flatten.ts's reserved-key check to reject. Converted
  // to a plain object via Object.fromEntries below, which (verified:
  // `Object.fromEntries([['__proto__', 1]])` yields an own `__proto__` data
  // property) builds each entry as a genuine own property the same way —
  // and, unlike the Object.defineProperty this replaces, isn't a sink
  // CodeQL treats as remote-property-injection (js/remote-property-injection).
  const result = new Map<string, unknown>();

  for (const rawKey of Object.keys(node)) {
    const childPathSegments = [...pathSegments, rawKey];
    const childValue = node[rawKey];

    if (fileMarkerKey !== undefined && rawKey === fileMarkerKey) {
      // A `_file` node's own flattened env key drops the marker segment and
      // gains the __FILE suffix, matching flatten.ts's
      // toEnvKey(pathSegments, VAR_FILE_SUFFIX) in processFileMarkerNode —
      // pathSegments there is the *parent's* path, not including "_file".
      if (typeof childValue === 'string') {
        const resolved = resolveInterpolatedScalar(childValue, childPathSegments, env);
        if (resolved === undefined) {
          result.set(rawKey, childValue);
        } else {
          interpolatedKeys.add(toEnvKey(envKeySegments, VAR_FILE_SUFFIX));
          result.set(rawKey, resolved);
        }
      } else {
        result.set(rawKey, childValue);
      }
      continue;
    }

    result.set(
      rawKey,
      interpolateValue(
        childValue,
        childPathSegments,
        [...envKeySegments, rawKey],
        env,
        interpolatedKeys,
      ),
    );
  }

  return Object.fromEntries(result);
}

/**
 * Substitute whole-scalar `${NAME}` / `${NAME:-default}` references in a
 * parsed `drydock.yml` document, ahead of `flattenConfigTree`. Returns a new
 * tree — the input is never mutated — plus the set of `DD_*` keys whose
 * value came from this substitution.
 */
export function interpolateConfigTree(
  tree: unknown,
  env: Record<string, string | undefined> = process.env,
): InterpolateConfigTreeResult {
  const interpolatedKeys = new Set<string>();
  if (!isPlainObject(tree)) {
    // Not a mapping: flatten.ts's own root check rejects this. Nothing to
    // interpolate, so pass it through unchanged for that check to catch.
    return { tree, interpolatedKeys };
  }
  const interpolatedTree = interpolateMapping(tree, [], [], env, interpolatedKeys);
  return { tree: interpolatedTree, interpolatedKeys };
}
