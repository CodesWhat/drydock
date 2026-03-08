export type HassAttributePreset = 'full' | 'short';

export const HASS_ATTRIBUTE_PRESET_VALUES: HassAttributePreset[] = ['full', 'short'];

export const HASS_ATTRIBUTE_PRESETS: Record<HassAttributePreset, string[]> = {
  full: [],
  short: [
    'security.sbom.documents',
    'security.updateSbom.documents',
    'security.scan.vulnerabilities',
    'security.updateScan.vulnerabilities',
    'details',
    'labels',
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

/**
 * Clone one object level while preserving prototype.
 * Data properties are copied by reference; nested values are not traversed.
 */
function cloneObjectShallow<T extends object>(value: T): T {
  const clone = Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      continue;
    }
    if ('value' in descriptor) {
      Object.defineProperty(clone, key, {
        value: descriptor.value,
        enumerable: descriptor.enumerable,
        writable: true,
        configurable: true,
      });
      continue;
    }
    Object.defineProperty(clone, key, {
      get: descriptor.get,
      set: descriptor.set,
      enumerable: descriptor.enumerable,
      configurable: true,
    });
  }
  return clone as T;
}

/**
 * Delete a property from an object by dot-path (e.g. "security.sbom.documents").
 */
function deleteBySegments(obj: Record<string, unknown>, segments: string[]): void {
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current == null || typeof current !== 'object') {
      return;
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }
  if (current != null && typeof current === 'object') {
    delete (current as Record<string, unknown>)[segments[segments.length - 1]];
  }
}

/**
 * Clone only the ancestor branches needed to safely delete a specific path.
 * Unrelated nested fields keep original references (no full deep clone).
 */
function clonePathAncestors(
  sourceRoot: Record<string, unknown>,
  cloneRoot: Record<string, unknown>,
  segments: string[],
): void {
  let sourceCurrent: unknown = sourceRoot;
  let cloneCurrent: unknown = cloneRoot;

  for (let i = 0; i < segments.length - 1; i++) {
    if (!isRecord(sourceCurrent) || !isRecord(cloneCurrent)) {
      return;
    }

    const key = segments[i];
    const sourceChild = sourceCurrent[key];
    if (!isRecord(sourceChild)) {
      return;
    }

    const cloneChild = cloneCurrent[key];
    if (cloneChild === sourceChild) {
      cloneCurrent[key] = cloneObjectShallow(sourceChild);
    }

    sourceCurrent = sourceChild;
    cloneCurrent = cloneCurrent[key];
  }
}

/**
 * Filter a container object by removing properties at the given dot-paths.
 * Returns the original container when excludePaths is empty (zero overhead).
 * Clones only path ancestors that are needed for deletions.
 */
export function filterContainer<T>(container: T, excludePaths: string[]): T {
  if (excludePaths.length === 0) {
    return container;
  }
  if (!isRecord(container)) {
    return container;
  }

  const sourceRoot = container as Record<string, unknown>;
  const clone = cloneObjectShallow(sourceRoot);

  for (const path of excludePaths) {
    const segments = path.split('.');
    clonePathAncestors(sourceRoot, clone, segments);
    deleteBySegments(clone, segments);
  }

  return clone as T;
}
