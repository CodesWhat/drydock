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

/**
 * Delete a property from an object by dot-path (e.g. "security.sbom.documents").
 */
function deleteByDotPath(obj: Record<string, unknown>, dotPath: string): void {
  const segments = dotPath.split('.');
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
 * Filter a container object by removing properties at the given dot-paths.
 * Returns the original container when excludePaths is empty (zero overhead).
 * Deep-clones via JSON round-trip to resolve getters and avoid mutating the source.
 */
export function filterContainer<T>(container: T, excludePaths: string[]): T {
  if (excludePaths.length === 0) {
    return container;
  }
  const clone = JSON.parse(JSON.stringify(container));
  for (const path of excludePaths) {
    deleteByDotPath(clone, path);
  }
  return clone;
}
