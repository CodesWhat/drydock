import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

function compareSemver(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const difference = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

function resolvedVersion(lockfile, packageName) {
  return lockfile.packages?.[`node_modules/${packageName}`]?.version;
}

test('fast-uri is pinned to the patched 3.x release in app and ui', () => {
  for (const workspace of ['app', 'ui']) {
    const manifest = readJson(`${workspace}/package.json`);
    const lockfile = readJson(`${workspace}/package-lock.json`);

    assert.equal(manifest.overrides?.['fast-uri'], '3.1.4', `${workspace} override`);
    assert.ok(
      compareSemver(resolvedVersion(lockfile, 'fast-uri'), '3.1.4') >= 0,
      `${workspace} lockfile`,
    );
  }
});

test('fast-xml-parser is pinned to the patched release in app', () => {
  const manifest = readJson('app/package.json');
  const lockfile = readJson('app/package-lock.json');

  assert.equal(manifest.dependencies?.['fast-xml-parser'], '5.10.1');
  assert.equal(manifest.overrides?.['fast-xml-parser'], '5.10.1');
  assert.ok(compareSemver(resolvedVersion(lockfile, 'fast-xml-parser'), '5.10.1') >= 0);
});

test('sharp is pinned to a patched release in the website', () => {
  const manifest = readJson('apps/web/package.json');
  const lockfile = readJson('apps/web/package-lock.json');

  assert.equal(manifest.overrides?.sharp, '0.35.3');
  assert.ok(compareSemver(resolvedVersion(lockfile, 'sharp'), '0.35.0') >= 0);
});

test('the rc.3 changelog records the security dependency refresh', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const rc3 = changelog.split('## [1.6.0-rc.2]')[0];

  assert.match(rc3, /CVE-2026-16221/);
  assert.match(rc3, /GHSA-8r6m-32jq-jx6q/);
  assert.match(rc3, /GHSA-f88m-g3jw-g9cj/);
  assert.match(rc3, /`fast-uri` to 3\.1\.4/);
  assert.match(rc3, /`fast-xml-parser` to 5\.10\.1/);
  assert.match(rc3, /`sharp` dependency to 0\.35\.3/);
});
