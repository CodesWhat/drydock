/**
 * Pure diff-based reconciliation for roadmap 7.1 slice 6
 * (spec-7.1-config-file.md section 4.3): decide which registered components
 * to leave alone, deregister, or (re-)register when a configuration reload
 * produces a new desired state, without ever tearing down every component
 * and starting over.
 *
 * Deliberately free of any registry, component, or I/O dependency — this
 * module only compares two `id -> canonical JSON` maps. `../registry/index.ts`
 * owns building both maps (the registered raw configuration per id, and the
 * newly-computed desired configuration per id) and applying the plan this
 * produces via `registerComponent`/`deregisterComponent`. Keeping the compare
 * step pure is what makes it exhaustively unit-testable without constructing
 * a single real component.
 */

export interface ReconcilePlan {
  /** Ids present in `desired` but not `current`: to be registered. */
  add: string[];
  /** Ids present in both, with a different canonical configuration: to be
   * deregistered then re-registered. */
  change: string[];
  /** Ids present in `current` but not `desired`: to be deregistered. */
  remove: string[];
  /** Ids present in both, with an identical canonical configuration: left
   * untouched. The property that makes reload safe — an unchanged component
   * is never torn down. */
  unchanged: string[];
}

/**
 * Diff two `id -> canonical configuration JSON` maps and classify every id
 * into exactly one of `add`/`change`/`remove`/`unchanged`. Every returned
 * array is sorted for a deterministic result independent of Map iteration
 * order (insertion order, which callers build from `Object.entries()` over
 * env-derived objects and can't guarantee is stable across two computations).
 */
export function diffComponentConfigurations(
  current: ReadonlyMap<string, string>,
  desired: ReadonlyMap<string, string>,
): ReconcilePlan {
  const add: string[] = [];
  const change: string[] = [];
  const remove: string[] = [];
  const unchanged: string[] = [];

  for (const id of current.keys()) {
    if (!desired.has(id)) {
      remove.push(id);
    }
  }

  for (const [id, desiredJson] of desired) {
    if (!current.has(id)) {
      add.push(id);
    } else if (current.get(id) !== desiredJson) {
      change.push(id);
    } else {
      unchanged.push(id);
    }
  }

  return {
    add: add.sort(),
    change: change.sort(),
    remove: remove.sort(),
    unchanged: unchanged.sort(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deterministically stringify a raw component configuration for use as a
 * diff key: object keys are sorted recursively before `JSON.stringify` so two
 * configurations built from the same data in a different key order (which
 * `Object.entries()` over an env-derived object can't guarantee against)
 * compare equal rather than spuriously reading as "changed".
 */
export function canonicalConfigurationJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalize(value[key]);
        return accumulator;
      }, {});
  }
  return value;
}
