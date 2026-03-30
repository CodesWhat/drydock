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

test('package manifest explicitly pins brace-expansion to the patched version', () => {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.5');
});

test('package lockfile does not resolve vulnerable brace-expansion versions', () => {
  const lockfilePath = join(process.cwd(), 'package-lock.json');
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const vulnerableEntries = Object.entries(lockfile.packages ?? {})
    .filter(
      ([path, value]) => path.includes('brace-expansion') && typeof value.version === 'string',
    )
    .filter(([, value]) => compareSemver(value.version, '5.0.5') < 0);

  assert.deepEqual(vulnerableEntries, []);
});
