import {
  filterContainer,
  filterContainerInclude,
  HASS_ATTRIBUTE_PRESET_VALUES,
  HASS_ATTRIBUTE_PRESETS,
} from './filter.js';

describe('filterContainer', () => {
  const container = {
    name: 'test',
    watcher: 'local',
    details: { ports: ['80/tcp'], volumes: ['/data'], env: [{ key: 'FOO', value: 'bar' }] },
    labels: { 'com.docker.compose.project': 'app' },
    security: {
      scan: {
        scanner: 'trivy',
        status: 'passed',
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        vulnerabilities: [{ id: 'CVE-2024-0001', severity: 'HIGH' }],
      },
      sbom: {
        format: 'spdx',
        documents: [{ spdxVersion: 'SPDX-2.3', packages: ['large-payload'] }],
      },
      updateScan: {
        scanner: 'trivy',
        status: 'passed',
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        vulnerabilities: [{ id: 'CVE-2024-0002', severity: 'LOW' }],
      },
      updateSbom: {
        format: 'cyclonedx',
        documents: [{ bomFormat: 'CycloneDX' }],
      },
    },
    image: { name: 'nginx', tag: { value: '1.25', semver: true } },
  };

  test('returns container unchanged (same reference) when excludePaths is empty', () => {
    const result = filterContainer(container, []);
    expect(result).toBe(container);
  });

  test('returns primitive input unchanged when exclusions are requested', () => {
    const result = filterContainer('container-as-string', ['security.sbom.documents']);
    expect(result).toBe('container-as-string');
  });

  test('strips single top-level field', () => {
    const result = filterContainer(container, ['details']);
    expect(result).not.toHaveProperty('details');
    expect(result).toHaveProperty('name', 'test');
  });

  test('strips nested field preserving siblings', () => {
    const result = filterContainer(container, ['security.sbom.documents']);
    expect(result.security.sbom).not.toHaveProperty('documents');
    expect(result.security.sbom).toHaveProperty('format', 'spdx');
    expect(result.security.scan.vulnerabilities).toHaveLength(1);
  });

  test('strips multiple paths simultaneously', () => {
    const result = filterContainer(container, [
      'security.sbom.documents',
      'security.scan.vulnerabilities',
      'details',
      'labels',
    ]);
    expect(result).not.toHaveProperty('details');
    expect(result).not.toHaveProperty('labels');
    expect(result.security.sbom).not.toHaveProperty('documents');
    expect(result.security.scan).not.toHaveProperty('vulnerabilities');
    expect(result.security.scan).toHaveProperty('status', 'passed');
  });

  test('handles non-existent paths gracefully', () => {
    const result = filterContainer(container, ['nonexistent.deep.path']);
    expect(result).toEqual(JSON.parse(JSON.stringify(container)));
  });

  test('handles undefined intermediate segments', () => {
    const shallow = { name: 'test', image: { name: 'nginx' } };
    const result = filterContainer(shallow, ['security.sbom.documents']);
    expect(result).toEqual({ name: 'test', image: { name: 'nginx' } });
  });

  test('skips delete when the final parent segment resolves to a primitive', () => {
    const shallow = { security: 'not-an-object' };
    const result = filterContainer(shallow, ['security.sbom']);
    expect(result).toEqual({ security: 'not-an-object' });
  });

  test('ignores proxy keys that do not provide property descriptors', () => {
    const source = {
      security: {
        sbom: {
          format: 'spdx',
          documents: [{ id: 'doc-1' }],
        },
      },
    };
    const proxy = new Proxy(source, {
      ownKeys(target) {
        return [...Reflect.ownKeys(target), 'ghost'];
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'ghost') {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });

    const result = filterContainer(proxy, ['security.sbom.documents']);

    expect(result.security.sbom).toEqual({ format: 'spdx' });
  });

  test('returns early when a cloned ancestor path resolves to a non-object value', () => {
    let reads = 0;
    const containerWithFlakyGetter = Object.create(null, {
      security: {
        get: () => {
          reads += 1;
          if (reads === 1) {
            return { sbom: { format: 'spdx', documents: [{ id: 'doc-1' }] } };
          }
          return 'not-an-object';
        },
        enumerable: true,
        configurable: true,
      },
    }) as { security: unknown };

    const result = filterContainer(containerWithFlakyGetter, ['security.sbom.documents']);

    expect(result.security).toBe('not-an-object');
  });

  test('does not mutate the original container', () => {
    const original = JSON.parse(JSON.stringify(container));
    filterContainer(container, ['security.sbom.documents', 'details']);
    expect(container).toEqual(original);
  });

  test('resolves computed getters in output', () => {
    const withGetter = Object.create(null, {
      name: { value: 'test', enumerable: true },
      computed: { get: () => 'resolved-value', enumerable: true },
    });
    const result = filterContainer(withGetter, ['nonexistent']);
    expect(result).toHaveProperty('computed', 'resolved-value');
  });

  test('does not evaluate unrelated getters when filtering specific paths', () => {
    const withExpensiveGetter = Object.create(null, {
      security: {
        value: { sbom: { format: 'spdx', documents: [{ id: 'doc' }] } },
        enumerable: true,
      },
      expensive: {
        get: () => {
          throw new Error('unrelated getter should not be evaluated');
        },
        enumerable: true,
      },
    });

    let result:
      | {
          security: { sbom: { format: string; documents?: { id: string }[] } };
          expensive?: unknown;
        }
      | undefined;
    expect(() => {
      result = filterContainer(withExpensiveGetter, ['security.sbom.documents']);
    }).not.toThrow();
    expect(result?.security.sbom).not.toHaveProperty('documents');
    expect(result?.security.sbom).toHaveProperty('format', 'spdx');
    expect(Object.getOwnPropertyDescriptor(result, 'expensive')).toMatchObject({
      get: expect.any(Function),
    });
  });
});

describe('filterContainerInclude', () => {
  const flattenedContainer = {
    name: 'test',
    watcher: 'local',
    image_name: 'nginx',
    result_tag: '1.26',
    security_scan_status: 'passed',
    security_scan_vulnerabilities_0_id: 'CVE-2024-0001',
  };

  test('returns container unchanged (same reference) when includePaths is empty', () => {
    const result = filterContainerInclude(flattenedContainer, []);
    expect(result).toBe(flattenedContainer);
  });

  test('returns primitive input unchanged when includePaths are requested', () => {
    const result = filterContainerInclude('container-as-string', ['name']);
    expect(result).toBe('container-as-string');
  });

  test('keeps only included top-level keys', () => {
    const result = filterContainerInclude(flattenedContainer, ['name', 'image_name', 'result_tag']);
    expect(result).toEqual({
      name: 'test',
      image_name: 'nginx',
      result_tag: '1.26',
    });
  });

  test('ignores include keys that do not exist', () => {
    const result = filterContainerInclude(flattenedContainer, ['name', 'does_not_exist']);
    expect(result).toEqual({
      name: 'test',
    });
  });

  test('does not mutate the original container', () => {
    const original = JSON.parse(JSON.stringify(flattenedContainer));
    filterContainerInclude(flattenedContainer, ['name']);
    expect(flattenedContainer).toEqual(original);
  });
});

describe('HASS_ATTRIBUTE_PRESETS', () => {
  test('full preset has empty exclude list', () => {
    expect(HASS_ATTRIBUTE_PRESETS.full).toEqual([]);
  });

  test('short preset contains expected paths', () => {
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('security.sbom.documents');
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('security.updateSbom.documents');
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('security.scan.vulnerabilities');
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('security.updateScan.vulnerabilities');
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('details');
    expect(HASS_ATTRIBUTE_PRESETS.short).toContain('labels');
  });

  test('preset values list matches preset keys', () => {
    expect(HASS_ATTRIBUTE_PRESET_VALUES).toEqual(
      expect.arrayContaining(Object.keys(HASS_ATTRIBUTE_PRESETS)),
    );
    expect(Object.keys(HASS_ATTRIBUTE_PRESETS)).toEqual(
      expect.arrayContaining(HASS_ATTRIBUTE_PRESET_VALUES),
    );
  });
});
