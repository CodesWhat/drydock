import { describe, expect, test } from 'vitest';
import {
  createProjectionView,
  stripContainerDetailOnlySecurityFields,
} from './container-projection.js';

function createScan(image: string, vulnerabilityCount = 2) {
  return {
    scanner: 'trivy',
    image,
    scannedAt: '2026-08-29T00:00:00.000Z',
    status: 'unsafe',
    blockSeverities: ['critical'],
    blockingCount: 1,
    summary: { unknown: 0, low: 1, medium: 0, high: 0, critical: 1 },
    vulnerabilities: Array.from({ length: vulnerabilityCount }, (_unused, index) => ({
      id: `CVE-2026-${index}`,
      severity: 'CRITICAL',
    })),
  };
}

describe('createProjectionView', () => {
  test('reads overridden values and passes everything else through', () => {
    const view = createProjectionView({ kept: 'a', replaced: 'b' }, [['replaced', 'c']]);

    expect(view.replaced).toBe('c');
    expect(view.kept).toBe('a');
  });

  test('reports an overridden key that the target does not have', () => {
    const view = createProjectionView({ kept: 'a' } as Record<string, unknown>, [['added', 1]]);

    expect('added' in view).toBe(true);
    expect('kept' in view).toBe(true);
    expect('missing' in view).toBe(false);
    expect(Object.keys(view).sort()).toEqual(['added', 'kept']);
    expect(view.added).toBe(1);
  });

  test('serialises and spreads with the overridden values', () => {
    const view = createProjectionView({ a: 1, b: 2 }, [['b', 9]]);

    expect(JSON.parse(JSON.stringify(view))).toEqual({ a: 1, b: 9 });
    expect({ ...view }).toEqual({ a: 1, b: 9 });
  });

  test('an undefined override is an own key that JSON drops', () => {
    const view = createProjectionView({ a: 1, b: 2 }, [['b', undefined]]);

    expect(Object.keys(view).sort()).toEqual(['a', 'b']);
    expect(JSON.parse(JSON.stringify(view))).toEqual({ a: 1 });
  });

  test('keeps a non-configurable non-writable property reportable when the value is unchanged', () => {
    const target = {};
    Object.defineProperty(target, 'frozen', {
      value: 'same',
      writable: false,
      configurable: false,
      enumerable: true,
    });
    const view = createProjectionView(target, [['frozen', 'same']]);

    expect(Object.getOwnPropertyDescriptor(view, 'frozen')).toEqual({
      value: 'same',
      writable: false,
      configurable: false,
      enumerable: true,
    });
  });

  test('reports a writable override as writable', () => {
    const view = createProjectionView({ a: 1 }, [['a', 2]]);

    expect(Object.getOwnPropertyDescriptor(view, 'a')).toEqual({
      value: 2,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  test('reports an accessor-backed override as writable', () => {
    const target = {};
    Object.defineProperty(target, 'computed', {
      get: () => 'original',
      configurable: true,
      enumerable: true,
    });
    const view = createProjectionView(target, [['computed', 'override']]);

    expect(Object.getOwnPropertyDescriptor(view, 'computed')).toEqual({
      value: 'override',
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });
});

describe('stripContainerDetailOnlySecurityFields', () => {
  test('returns the container untouched when it carries no security block', () => {
    const container = { id: 'c1', name: 'nginx' };

    expect(stripContainerDetailOnlySecurityFields(container)).toBe(container);
  });

  test('empties both vulnerability arrays and drops the detail-only documents', () => {
    const container = {
      id: 'c1',
      security: {
        scan: createScan('acme/web:1.0.0'),
        updateScan: createScan('acme/web:1.1.0'),
        sbom: { generator: 'trivy', components: ['a', 'b'] },
        updateSbom: { generator: 'trivy', components: ['a', 'b'] },
        signature: { verifier: 'cosign', status: 'verified' },
        updateSignature: { verifier: 'cosign', status: 'verified' },
      },
    } as never;

    const projected = JSON.parse(JSON.stringify(stripContainerDetailOnlySecurityFields(container)));

    expect(projected.security.scan.vulnerabilities).toEqual([]);
    expect(projected.security.updateScan.vulnerabilities).toEqual([]);
    expect(projected.security.scan.blockingCount).toBe(1);
    expect(projected.security.scan.summary).toEqual({
      unknown: 0,
      low: 1,
      medium: 0,
      high: 0,
      critical: 1,
    });
    expect(projected.security.sbom).toBeUndefined();
    expect(projected.security.updateSbom).toBeUndefined();
    expect(projected.security.signature).toBeUndefined();
    expect(projected.security.updateSignature).toBeUndefined();
  });

  test('leaves the source container object unmodified', () => {
    const scan = createScan('acme/web:1.0.0');
    const container = { id: 'c1', security: { scan } } as never;

    stripContainerDetailOnlySecurityFields(container);

    expect(scan.vulnerabilities).toHaveLength(2);
  });

  test('keeps a security block that has neither scan nor updateScan', () => {
    const container = {
      id: 'c1',
      security: { sbom: { generator: 'trivy' } },
    } as never;

    const projected = stripContainerDetailOnlySecurityFields(container) as {
      security: { scan?: unknown; updateScan?: unknown; sbom?: unknown };
    };

    expect(projected.security.scan).toBeUndefined();
    expect(projected.security.updateScan).toBeUndefined();
    expect(projected.security.sbom).toBeUndefined();
  });

  test('keeps the vulnerability arrays when asked not to strip them', () => {
    const container = {
      id: 'c1',
      security: {
        scan: createScan('acme/web:1.0.0'),
        updateScan: createScan('acme/web:1.1.0'),
        sbom: { generator: 'trivy' },
      },
    } as never;

    const projected = stripContainerDetailOnlySecurityFields(container, false) as {
      security: {
        scan: { vulnerabilities: unknown[] };
        updateScan: { vulnerabilities: unknown[] };
        sbom?: unknown;
      };
    };

    expect(projected.security.scan.vulnerabilities).toHaveLength(2);
    expect(projected.security.updateScan.vulnerabilities).toHaveLength(2);
    expect(projected.security.sbom).toBeUndefined();
  });
});
