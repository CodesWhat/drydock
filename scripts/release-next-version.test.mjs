import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bumpSemver, inferReleaseLevel, resolveAutoRelease } from './release-next-version.mjs';

const scriptPath = fileURLToPath(new URL('./release-next-version.mjs', import.meta.url));

test('infers minor when at least one feat commit exists', () => {
  const level = inferReleaseLevel([
    '🐛 fix(api): resolve edge case',
    '✨ feat(auth): add oidc issuer validation',
  ]);
  assert.equal(level, 'minor');
});

test('infers patch when only patch-level commit types exist', () => {
  const level = inferReleaseLevel([
    '🐛 fix(api): resolve edge case',
    '🔧 chore(ci): tighten retries',
  ]);
  assert.equal(level, 'patch');
});

test('infers major for breaking change footer', () => {
  const level = inferReleaseLevel([
    '✨ feat(api): rename response envelope\n\nBREAKING CHANGE: removed legacy alias',
  ]);
  assert.equal(level, 'major');
});

test('infers major for bang syntax', () => {
  const level = inferReleaseLevel(['✨ feat(api)!: remove legacy endpoint']);
  assert.equal(level, 'major');
});

test('returns null when there are no releasable commits', () => {
  const level = inferReleaseLevel(['Merge pull request #123 from CodesWhat/release/v1.5.0']);
  assert.equal(level, null);
});

test('bumps patch versions', () => {
  assert.equal(bumpSemver('1.4.9', 'patch'), '1.4.10');
});

test('bumps minor versions', () => {
  assert.equal(bumpSemver('1.4.9', 'minor'), '1.5.0');
});

test('bumps major versions', () => {
  assert.equal(bumpSemver('1.4.9', 'major'), '2.0.0');
});

test('accepts v-prefixed versions', () => {
  assert.equal(bumpSemver('v1.4.9', 'patch'), '1.4.10');
});

test('throws for invalid current versions', () => {
  assert.throws(() => bumpSemver('1.4', 'patch'), /Invalid current version: 1\.4/u);
});

test('throws for invalid release levels', () => {
  assert.throws(() => bumpSemver('1.4.9', 'prerelease'), /Invalid release level: prerelease/u);
});

test('prefers an explicit stable release commit over later patch-level commits', () => {
  const result = resolveAutoRelease('1.4.5', [
    '🔒 security(ci): fix Scorecard alerts + auto-tag pre-release crash',
    'v1.5.0 — Observability, Dashboard Customization & Hardening (#196)',
  ]);

  assert.deepEqual(result, {
    releaseLevel: 'minor',
    nextVersion: '1.5.0',
  });
});

test('ignores prerelease branch names when resolving an explicit stable release', () => {
  const result = resolveAutoRelease('1.4.5', [
    'Merge pull request #142 from CodesWhat/release/v1.4.0-rc.13',
    '🐛 fix(api): resolve edge case',
  ]);

  assert.deepEqual(result, {
    releaseLevel: 'patch',
    nextVersion: '1.4.6',
  });
});

test('cli reports "no releasable commits" for empty auto-release ranges', () => {
  const result = spawnSync(
    process.execPath,
    [scriptPath, '--current', '1.4.5', '--bump', 'auto', '--from', 'HEAD', '--to', 'HEAD'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no releasable commits/i);
});
