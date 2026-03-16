import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommitMessage } from './commit-message.mjs';

test('accepts a valid feat message with scope', () => {
  const result = validateCommitMessage('✨ feat(docker): add health check endpoint');
  assert.equal(result.valid, true);
});

test('accepts a valid fix message without scope', () => {
  const result = validateCommitMessage('🐛 fix: resolve socket EACCES (#38)');
  assert.equal(result.valid, true);
});

test('rejects message without emoji prefix', () => {
  const result = validateCommitMessage('feat(docker): add health check endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /emoji/i);
});

test('rejects unknown commit type', () => {
  const result = validateCommitMessage('✨ feature(api): add endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /type/i);
});

test('rejects mismatched emoji/type pairs', () => {
  const result = validateCommitMessage('✨ fix(api): resolve edge case');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /emoji\/type pair/i);
});

test('rejects trailing period', () => {
  const result = validateCommitMessage('✨ feat(api): add endpoint.');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /trailing period/i);
});

test('allows auto-generated merge commits', () => {
  const result = validateCommitMessage('Merge pull request #123 from CodesWhat/release/v1.5.0');
  assert.equal(result.valid, true);
});

test('allows default git revert commits', () => {
  const result = validateCommitMessage('Revert "✨ feat(api): add endpoint"');
  assert.equal(result.valid, true);
});
