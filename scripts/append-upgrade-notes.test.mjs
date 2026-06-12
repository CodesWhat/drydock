import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendUpgradeNotes,
  appliesToVersion,
  UPGRADE_NOTES_MARKER,
} from './append-upgrade-notes.mjs';

const UPGRADE = `<!-- ${UPGRADE_NOTES_MARKER} -->\n> [!WARNING]\n> upgrade notes body`;
const NOTES = '# v1.5.0-rc.36\n\n## [1.5.0-rc.36] — 2026-06-20\n\n### Fixed\n- a fix\n';

test('applies to 1.4.6+ and every 1.5.x version including release candidates', () => {
  assert.equal(appliesToVersion('1.4.6'), true);
  assert.equal(appliesToVersion('v1.4.7'), true);
  assert.equal(appliesToVersion('1.5.0'), true);
  assert.equal(appliesToVersion('v1.5.0-rc.36'), true);
  assert.equal(appliesToVersion('1.5.7'), true);
});

test('does not apply to 1.4.0–1.4.5, 1.6+, or Unreleased', () => {
  assert.equal(appliesToVersion('1.4.5'), false);
  assert.equal(appliesToVersion('1.4.0'), false);
  assert.equal(appliesToVersion('1.6.0'), false);
  assert.equal(appliesToVersion('2.0.0'), false);
  assert.equal(appliesToVersion('Unreleased'), false);
});

test('appends the upgrade block for an applicable version', () => {
  const out = appendUpgradeNotes(NOTES, UPGRADE, '1.5.0-rc.36');
  assert.match(out, /upgrade notes body/u);
  assert.ok(out.includes(UPGRADE_NOTES_MARKER));
  assert.ok(out.startsWith(NOTES.replace(/\s+$/u, '')));
  assert.ok(out.endsWith('\n'));
});

test('does not append for a non-applicable version', () => {
  assert.equal(appendUpgradeNotes(NOTES, UPGRADE, '1.4.5'), NOTES);
});

test('is idempotent when the marker is already present', () => {
  const once = appendUpgradeNotes(NOTES, UPGRADE, '1.5.0');
  const twice = appendUpgradeNotes(once, UPGRADE, '1.5.0');
  assert.equal(twice, once);
});

test('returns notes unchanged when the upgrade block is empty', () => {
  assert.equal(appendUpgradeNotes(NOTES, '   ', '1.5.0'), NOTES);
});
