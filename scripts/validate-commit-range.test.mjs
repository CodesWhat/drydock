import assert from 'node:assert/strict';
import test from 'node:test';
import { main, parseArgs } from './validate-commit-range.mjs';

test('parseArgs requires --base and --head', () => {
  assert.throws(() => parseArgs(['--base', 'abc123']), /Missing required arguments/);
  assert.throws(() => parseArgs(['--head', 'def456']), /Missing required arguments/);
});

test('main returns non-zero when commit range contains invalid messages', () => {
  const stdout = [];
  const stderr = [];

  const exitCode = main(['--base', 'abc123', '--head', 'def456'], {
    getCommits: () => [
      { sha: '1111111', message: '✨ feat(api): add health endpoint' },
      { sha: '2222222', message: 'fix(api): missing emoji prefix' },
    ],
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.match(stderr.join('\n'), /2222222/);
  assert.match(stderr.join('\n'), /Invalid commit message/);
});

test('main succeeds when all commit messages in range are valid', () => {
  const stdout = [];
  const stderr = [];

  const exitCode = main(['--base', 'abc123', '--head', 'def456'], {
    getCommits: () => [
      { sha: '1111111', message: '✨ feat(api): add health endpoint' },
      { sha: '2222222', message: '🐛 fix(ci): handle missing env var' },
    ],
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join('\n'), /Validated 2 commit message\(s\)/);
});
