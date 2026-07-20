import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const MINIMUM_SAFE_YAML_VERSION = '2.8.3';

function compareSemver(a, b) {
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

test('package manifest explicitly pins yaml to the patched version', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const pinnedVersion = packageJson.overrides?.yaml;

  assert.equal(typeof pinnedVersion, 'string');
  assert.match(pinnedVersion, /^\d+\.\d+\.\d+$/u);
  assert.ok(compareSemver(pinnedVersion, MINIMUM_SAFE_YAML_VERSION) >= 0);
});

test('package lockfile does not resolve vulnerable yaml versions', () => {
  const lockfile = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
  const vulnerableEntries = Object.entries(lockfile.packages ?? {})
    .filter(([path, value]) => path === 'node_modules/yaml' && typeof value.version === 'string')
    .filter(([, value]) => compareSemver(value.version, MINIMUM_SAFE_YAML_VERSION) < 0);

  assert.deepEqual(vulnerableEntries, []);
});
