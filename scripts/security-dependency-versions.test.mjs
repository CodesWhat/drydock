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

// Only the 4.x line is vetted now: 4.1.3 carries the August 2026 host-confusion
// and SSRF fixes in addition to the earlier CVE-2026-16221 fix.
// The transitional 3.1.4 branch was dropped once the override moved to 4.x,
// and any other major (including a future 5.x) fails until explicitly vetted.
function isFastUriPatched(version) {
  const major = Number(version.split('.')[0]);
  return major === 4 && compareSemver(version, '4.1.3') >= 0;
}

test('isFastUriPatched only accepts vetted 4.x releases at or above 4.1.3', () => {
  assert.ok(!isFastUriPatched('3.1.4'), '3.x is no longer a supported line and should fail');
  assert.ok(
    !isFastUriPatched('4.1.1'),
    '4.1.1 predates the backslash-authority fix and should fail',
  );
  assert.ok(!isFastUriPatched('4.1.2'), '4.1.2 predates the August advisory fixes');
  assert.ok(isFastUriPatched('4.1.3'), '4.1.3 (current floor) should pass');
  assert.ok(!isFastUriPatched('5.0.0'), 'an unvetted future major should fail');
});

// fast-uri is pinned to 4.1.3 in app/ and ui/ for the August 2026 advisory batch.
test('fast-uri is pinned to a patched release in app and ui', () => {
  for (const workspace of ['app', 'ui']) {
    const manifest = readJson(`${workspace}/package.json`);
    const lockfile = readJson(`${workspace}/package-lock.json`);

    assert.ok(isFastUriPatched(manifest.overrides?.['fast-uri']), `${workspace} override`);
    assert.ok(isFastUriPatched(resolvedVersion(lockfile, 'fast-uri')), `${workspace} lockfile`);
  }
});

// brace-expansion 5.0.8 was vulnerable to CVE-2026-69152 (GHSA-rgw5-rvv9-x895),
// patched in 5.0.9.
test('brace-expansion is pinned to a patched release in app, ui, and e2e', () => {
  for (const workspace of ['app', 'ui', 'e2e']) {
    const manifest = readJson(`${workspace}/package.json`);
    const lockfile = readJson(`${workspace}/package-lock.json`);

    assert.ok(
      compareSemver(manifest.overrides?.['brace-expansion'], '5.0.9') >= 0,
      `${workspace} override`,
    );
    assert.ok(
      compareSemver(resolvedVersion(lockfile, 'brace-expansion'), '5.0.9') >= 0,
      `${workspace} lockfile`,
    );
  }
});

// ip-address 10.2.0 was vulnerable to CVE-2026-54272, CVE-2026-69192, and
// CVE-2026-69198 (pulled in via express-rate-limit and mqtt -> socks in
// app), patched in 10.3.1.
test('ip-address is pinned to a patched release in app', () => {
  const manifest = readJson('app/package.json');
  const lockfile = readJson('app/package-lock.json');

  assert.ok(compareSemver(manifest.overrides?.['ip-address'], '10.3.1') >= 0, 'app override');
  assert.ok(compareSemver(resolvedVersion(lockfile, 'ip-address'), '10.3.1') >= 0, 'app lockfile');
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

  // Floor, not an exact pin: 16.2.11 closed the advisory batch, and routine
  // Renovate bumps past it must not fail the guard (16.x only — a new major
  // is a deliberate migration, not a routine bump).
  const manifestNext = manifest.dependencies?.next;
  assert.ok(manifestNext?.startsWith('16.'), 'apps/web next must stay on the vetted 16.x line');
  assert.ok(compareSemver(manifestNext, '16.2.11') >= 0);
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
