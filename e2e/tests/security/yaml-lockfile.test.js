const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

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

  assert.equal(packageJson.overrides?.yaml, '2.8.3');
});

test('package lockfile does not resolve vulnerable yaml versions', () => {
  const lockfile = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
  const vulnerableEntries = Object.entries(lockfile.packages ?? {})
    .filter(([path, value]) => path === 'node_modules/yaml' && typeof value.version === 'string')
    .filter(([, value]) => compareSemver(value.version, '2.8.3') < 0);

  assert.deepEqual(vulnerableEntries, []);
});
