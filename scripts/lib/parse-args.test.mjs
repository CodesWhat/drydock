import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from './parse-args.mjs';

test('returns empty object for empty argv', () => {
  assert.deepEqual(parseArgs([]), {});
});

test('parses a single --key value pair', () => {
  assert.deepEqual(parseArgs(['--version', '1.2.3']), { version: '1.2.3' });
});

test('parses multiple --key value pairs', () => {
  assert.deepEqual(parseArgs(['--version', '1.0.0', '--file', 'CHANGELOG.md']), {
    version: '1.0.0',
    file: 'CHANGELOG.md',
  });
});

test('skips positional arguments that do not start with --', () => {
  assert.deepEqual(parseArgs(['positional', '--key', 'val']), { key: 'val' });
});

test('throws when a flag has no following value', () => {
  assert.throws(() => parseArgs(['--version']), /Missing value for argument: --version/u);
});

test('throws when a flag is immediately followed by another flag', () => {
  assert.throws(
    () => parseArgs(['--version', '--file', 'CHANGELOG.md']),
    /Missing value for argument: --version/u,
  );
});

test('handles numeric-looking string values', () => {
  assert.deepEqual(parseArgs(['--count', '42']), { count: '42' });
});
