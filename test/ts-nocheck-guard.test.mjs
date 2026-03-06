import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTsNoCheckSets, parseAllowlist } from '../scripts/ts-nocheck-guard.mjs';

test('parseAllowlist ignores comments and empty lines', () => {
  const allowlist = parseAllowlist(`\n# existing debt\napp/a.ts\n\n  app/b.ts  \n`);
  assert.deepEqual(allowlist, ['app/a.ts', 'app/b.ts']);
});

test('compareTsNoCheckSets flags unexpected files and tracks retired ones', () => {
  const comparison = compareTsNoCheckSets({
    allowlist: ['app/a.ts', 'app/b.ts'],
    current: ['app/b.ts', 'app/c.ts'],
  });

  assert.deepEqual(comparison.unexpected, ['app/c.ts']);
  assert.deepEqual(comparison.retired, ['app/a.ts']);
  assert.equal(comparison.ok, false);
});

test('compareTsNoCheckSets is ok when current set is subset of allowlist', () => {
  const comparison = compareTsNoCheckSets({
    allowlist: ['app/a.ts', 'app/b.ts'],
    current: ['app/b.ts'],
  });

  assert.deepEqual(comparison.unexpected, []);
  assert.deepEqual(comparison.retired, ['app/a.ts']);
  assert.equal(comparison.ok, true);
});
