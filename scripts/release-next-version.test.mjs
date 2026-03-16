import assert from 'node:assert/strict';
import test from 'node:test';
import { bumpSemver, inferReleaseLevel } from './release-next-version.mjs';

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
