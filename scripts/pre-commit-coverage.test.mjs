import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pre-commit-coverage.sh');

// Runs the hook inside a scratch directory with a fake `npx` on PATH. The shim
// answers `vitest list` with one line per entry in FAKE_RELATED and records
// every invocation, so the tests can assert what the hook decided to run
// without touching a real vitest.
function runHook({ staged, related, env = {} }) {
  const root = mkdtempSync(path.join(tmpdir(), 'pre-commit-coverage-'));
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.log');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'app'));
  mkdirSync(path.join(root, 'ui'));
  writeFileSync(
    path.join(bin, 'npx'),
    [
      '#!/usr/bin/env bash',
      'echo "$(basename "$PWD"): $*" >> "$CALLS_LOG"',
      'if [ "$2" = "list" ]; then',
      '  if [ "${FAKE_LIST_EXIT:-0}" -ne 0 ]; then',
      '    echo "fake vitest list crashed" >&2',
      '    exit "${FAKE_LIST_EXIT}"',
      '  fi',
      '  i=0',
      '  while [ "$i" -lt "${FAKE_RELATED:-0}" ]; do i=$((i + 1)); echo "test-$i.test.ts"; done',
      '  exit 0',
      'fi',
      'exit "${FAKE_RUN_EXIT:-0}"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  try {
    const result = spawnSync('bash', [SCRIPT, ...staged], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS_LOG: calls,
        FAKE_RELATED: String(related),
        ...env,
      },
    });
    let recorded = '';
    try {
      recorded = readFileSync(calls, 'utf8');
    } catch {
      recorded = '';
    }
    return { ...result, calls: recorded.trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('skips when no app or ui files are staged', () => {
  const result = runHook({ staged: ['scripts/foo.sh', 'README.md'], related: 3 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No app\/ or ui\/ files staged/);
  assert.deepEqual(result.calls, []);
});

test('runs the related tests when the fan-out is under the cap', () => {
  const result = runHook({ staged: ['app/api/backup.ts'], related: 4 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /app: running 4 related test file\(s\)/);
  assert.deepEqual(result.calls, [
    'app: vitest list --changed HEAD --filesOnly',
    'app: vitest run --changed HEAD --reporter=dot',
  ]);
});

test('skips the run when a hub module fans out past the cap', () => {
  // DR-58: app/util/backup.ts is imported by every Docker-family trigger, so
  // `vitest --changed` resolved 24 suites and the hook was killed at its
  // timeout on every attempt, which left the change uncommittable without
  // bypassing the hook.
  const result = runHook({ staged: ['app/util/backup.ts'], related: 24 });
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /app: 24 related test files exceed the pre-commit cap of 10; skipping/,
  );
  assert.match(result.stdout, /pre-push coverage runs the full suite/);
  assert.deepEqual(result.calls, ['app: vitest list --changed HEAD --filesOnly']);
});

test('the cap is overridable per commit', () => {
  const result = runHook({
    staged: ['app/util/backup.ts'],
    related: 24,
    env: { PRE_COMMIT_MAX_RELATED_TESTS: '30' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /app: running 24 related test file\(s\)/);
  assert.equal(result.calls.length, 2);
});

test('skips the run when nothing relates to the staged files', () => {
  const result = runHook({ staged: ['ui/src/foo.vue'], related: 0 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ui: no test files relate to the staged changes; skipping/);
  assert.deepEqual(result.calls, ['ui: vitest list --changed HEAD --filesOnly']);
});

test('a failing test-discovery list fails the commit without running vitest', () => {
  const result = runHook({
    staged: ['app/api/backup.ts'],
    related: 2,
    env: { FAKE_LIST_EXIT: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app: failed to discover related test files\./);
  assert.deepEqual(result.calls, ['app: vitest list --changed HEAD --filesOnly']);
});

test('a failing related run still fails the commit', () => {
  const result = runHook({
    staged: ['app/api/backup.ts', 'ui/src/foo.vue'],
    related: 2,
    env: { FAKE_RUN_EXIT: '1' },
  });
  assert.equal(result.status, 1);
  // Fails fast on the first workspace, so ui never runs.
  assert.deepEqual(result.calls, [
    'app: vitest list --changed HEAD --filesOnly',
    'app: vitest run --changed HEAD --reporter=dot',
  ]);
});
