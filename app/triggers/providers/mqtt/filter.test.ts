import { filterContainer, HASS_ATTRIBUTE_PRESET_VALUES, HASS_ATTRIBUTE_PRESETS } from './filter.js';

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
