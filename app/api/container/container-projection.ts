import type { Container } from '../../model/container.js';

/**
 * Wrap `target` in a lazy view whose `overrides` shadow the underlying values.
 * Nothing is copied, so a projection over a large container object costs a
 * proxy rather than a deep clone, and `JSON.stringify` sees the overridden
 * values because `ownKeys`/`getOwnPropertyDescriptor` are trapped as well.
 */
export function createProjectionView<T extends object>(
  target: T,
  overrides: ReadonlyArray<readonly [string | symbol, unknown]>,
): T {
  const overrideMap = new Map<string | symbol, unknown>(overrides);

  return new Proxy(target, {
    get(viewTarget, property, receiver) {
      if (overrideMap.has(property)) {
        return overrideMap.get(property);
      }

      return Reflect.get(viewTarget, property, receiver);
    },
    has(viewTarget, property) {
      return overrideMap.has(property) || Reflect.has(viewTarget, property);
    },
    ownKeys(viewTarget) {
      const keys = new Set(Reflect.ownKeys(viewTarget));
      for (const key of overrideMap.keys()) {
        keys.add(key);
      }

      return Array.from(keys);
    },
    getOwnPropertyDescriptor(viewTarget, property) {
      if (!overrideMap.has(property)) {
        return Reflect.getOwnPropertyDescriptor(viewTarget, property);
      }

      const descriptor = Reflect.getOwnPropertyDescriptor(viewTarget, property);
      const overrideValue = overrideMap.get(property);
      const writable =
        descriptor &&
        'writable' in descriptor &&
        (!descriptor.configurable || descriptor.writable || descriptor.value === overrideValue)
          ? descriptor.writable
          : true;
      return {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        writable,
        value: overrideValue,
      };
    },
  });
}

function stripScanVulnerabilityArray<T extends object>(scan: T): T {
  return createProjectionView(scan, [['vulnerabilities', []]]);
}

// Fields in security that are detail-only (not used by the list view).
// - sbom / updateSbom: SBOM documents (potentially MB-scale); fetched via GET /:id/sbom
// - signature / updateSignature: cosign verification data; not rendered in the list
const SECURITY_LIST_STRIPPED_FIELDS = [
  'sbom',
  'updateSbom',
  'signature',
  'updateSignature',
] as const;

/**
 * Project a container down to the security shape the list view consumes:
 * summary/status/blockingCount/blockSeverities/scannedAt survive, the per-CVE
 * arrays and the SBOM/signature documents do not. Used by the container list
 * endpoint and by the SSE lifecycle broadcasts, which must agree on the shape.
 */
export function stripContainerDetailOnlySecurityFields<
  T extends { security?: Container['security'] },
>(container: T, stripVulnerabilities = true): T {
  if (!container.security) {
    return container;
  }

  const scanOverride = stripVulnerabilities
    ? container.security.scan
      ? stripScanVulnerabilityArray(container.security.scan)
      : undefined
    : container.security.scan;

  const updateScanOverride = stripVulnerabilities
    ? container.security.updateScan
      ? stripScanVulnerabilityArray(container.security.updateScan)
      : undefined
    : container.security.updateScan;

  const projectedSecurity = createProjectionView(container.security, [
    ['scan', scanOverride],
    ['updateScan', updateScanOverride],
    ...SECURITY_LIST_STRIPPED_FIELDS.map((field) => [field, undefined] as const),
  ]);

  return createProjectionView(container, [['security', projectedSecurity]]);
}
