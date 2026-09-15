import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index] ?? 0;
    const bPart = bParts[index] ?? 0;

    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}

type Manifest = { overrides?: Record<string, string> };
type Lockfile = { packages?: Record<string, { version?: string }> };

function assertYamlDependencies(packageJson: Manifest, lockfile: Lockfile) {
  const pin = packageJson.overrides?.yaml;
  expect(pin).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u);
  expect(compareSemver(pin, '2.9.0')).toBeGreaterThanOrEqual(0);

  const yamlEntries = Object.entries(lockfile.packages ?? {}).filter(
    ([path]) => path === 'node_modules/yaml' || path.endsWith('/node_modules/yaml'),
  );
  expect(yamlEntries.length).toBeGreaterThan(0);
  for (const [path, entry] of yamlEntries) {
    expect(entry.version, path).toBe(pin);
  }
}

function fixture(version = '2.9.0'): { manifest: Manifest; lockfile: Lockfile } {
  return {
    manifest: { overrides: { yaml: version } },
    lockfile: { packages: { 'node_modules/yaml': { version } } },
  };
}

describe('ui yaml security', () => {
  it('pins patched yaml consistently in the manifest and every lockfile install', () => {
    assertYamlDependencies(
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')),
      JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')),
    );
  });

  it.each(['2.9.0', '2.9.1', '2.10.0', '3.0.0'])('accepts a consistent safe pin %s', (version) => {
    const { manifest, lockfile } = fixture(version);
    lockfile.packages['node_modules/parent/node_modules/yaml'] = { version };
    expect(() => assertYamlDependencies(manifest, lockfile)).not.toThrow();
  });

  const invalidVersions = [
    undefined,
    '',
    '2.8.3',
    '1.99.99',
    '^2.9.0',
    '~2.9.0',
    '>=2.9.0',
    '*',
    'latest',
    'v2.9.0',
    '2.9',
    '2.9.0.1',
    '02.9.0',
    '2.9.0-beta.1',
    '2.9.0+build',
    '2.9.0\n',
    'garbage',
  ];
  it.each(invalidVersions)('rejects an invalid yaml override %s', (version) => {
    const { manifest, lockfile } = fixture();
    manifest.overrides.yaml = version;
    expect(() => assertYamlDependencies(manifest, lockfile)).toThrow();
  });

  for (const path of ['node_modules/yaml', 'node_modules/parent/node_modules/yaml']) {
    it.each(invalidVersions)(`rejects invalid ${path} version %s`, (version) => {
      const { manifest, lockfile } = fixture();
      lockfile.packages[path] = { version };
      expect(() => assertYamlDependencies(manifest, lockfile)).toThrow();
    });
    it(`rejects a safe but mismatched ${path} version`, () => {
      const { manifest, lockfile } = fixture();
      lockfile.packages[path] = { version: '2.9.1' };
      expect(() => assertYamlDependencies(manifest, lockfile)).toThrow();
    });
  }

  it.each([{}, { packages: {} }, { packages: { 'node_modules/not-yaml': { version: '2.9.0' } } }])(
    'rejects a lockfile with no yaml installs: %j',
    (lockfile) => {
      expect(() => assertYamlDependencies(fixture().manifest, lockfile)).toThrow();
    },
  );
  it('rejects a missing overrides section', () => {
    expect(() => assertYamlDependencies({}, fixture().lockfile)).toThrow();
  });
});
