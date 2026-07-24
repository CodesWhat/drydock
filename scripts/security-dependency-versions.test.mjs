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
  assert.ok(compareSemver(resolvedVersion(lockfile, 'sharp'), '0.35.3') >= 0);
});

test('Next.js is pinned past the 16.2.9 security advisory batch', () => {
  const manifest = readJson('apps/web/package.json');
  const lockfile = readJson('apps/web/package-lock.json');

  assert.equal(manifest.dependencies?.next, '16.2.11');
  assert.ok(compareSemver(resolvedVersion(lockfile, 'next'), '16.2.11') >= 0);
});

test('the rc.5 changelog records the Next.js security refresh', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const rc5Header = '## [1.6.0-rc.5]';
  const rc4Header = '## [1.6.0-rc.4]';
  const rc5Start = changelog.indexOf(rc5Header);
  const rc4Start = changelog.indexOf(rc4Header, rc5Start + rc5Header.length);

  assert.notEqual(rc5Start, -1, 'missing rc.5 changelog header');
  assert.notEqual(rc4Start, -1, 'missing rc.4 changelog boundary');

  const rc5 = changelog.slice(rc5Start, rc4Start);

  assert.match(rc5, /Next\.js 16\.2\.11/);
  assert.match(rc5, /GHSA-6gpp-xcg3-4w24/);
  assert.match(rc5, /GHSA-m99w-x7hq-7vfj/);
  assert.match(rc5, /GHSA-89xv-2m56-2m9x/);
});

test('the rc.3 changelog records the security dependency refresh', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const rc3Header = '## [1.6.0-rc.3]';
  const rc2Header = '## [1.6.0-rc.2]';
  const rc3Start = changelog.indexOf(rc3Header);
  const rc2Start = changelog.indexOf(rc2Header, rc3Start + rc3Header.length);

  assert.notEqual(rc3Start, -1, 'missing rc.3 changelog header');
  assert.notEqual(rc2Start, -1, 'missing rc.2 changelog boundary');

  const rc3 = changelog.slice(rc3Start, rc2Start);

  assert.match(rc3, /CVE-2026-16221/);
  assert.match(rc3, /GHSA-8r6m-32jq-jx6q/);
  assert.match(rc3, /GHSA-f88m-g3jw-g9cj/);
  assert.match(rc3, /`fast-uri` to 3\.1\.4/);
  assert.match(rc3, /`fast-xml-parser` to 5\.10\.1/);
  assert.match(rc3, /`sharp` dependency to 0\.35\.3/);
});
