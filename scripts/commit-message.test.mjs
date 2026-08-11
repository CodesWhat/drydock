import assert from 'node:assert/strict';
import test from 'node:test';
import { formatValidationFailure, validateCommitMessage } from './commit-message.mjs';

test('accepts a valid feat message with scope', () => {
  const result = validateCommitMessage('feat(docker): add health check endpoint');
  assert.equal(result.valid, true);
});

test('accepts a valid fix message without scope', () => {
  const result = validateCommitMessage('fix: resolve socket EACCES (#38)');
  assert.equal(result.valid, true);
});

test('accepts style type', () => {
  const result = validateCommitMessage('style(ui): align button padding');
  assert.equal(result.valid, true);
});

test('accepts refactor type', () => {
  const result = validateCommitMessage('refactor(api): split handlers module');
  assert.equal(result.valid, true);
});

test('accepts test type', () => {
  const result = validateCommitMessage('test(store): cover migration branch');
  assert.equal(result.valid, true);
});

test('accepts build type (retired "deps" type now lives here)', () => {
  const result = validateCommitMessage('build(deps): update axios 1.13 → 1.15');
  assert.equal(result.valid, true);
});

test('accepts ci type (retired "deploy" type now lives here)', () => {
  const result = validateCommitMessage('ci(deploy): retry flaky release job');
  assert.equal(result.valid, true);
});

test('accepts chore type (retired "config" type now lives here)', () => {
  const result = validateCommitMessage('chore(config): tighten lint rules');
  assert.equal(result.valid, true);
});

test('accepts refactor type for code removal (retired "remove" type now lives here)', () => {
  const result = validateCommitMessage('refactor(api): drop unused v0 endpoints');
  assert.equal(result.valid, true);
});

test('accepts revert type', () => {
  const result = validateCommitMessage('revert(ui): back out flaky dashboard widget');
  assert.equal(result.valid, true);
});

test('accepts breaking change marker with "!" before the colon', () => {
  const result = validateCommitMessage('feat(api)!: drop v1 tokens');
  assert.equal(result.valid, true);
});

test('accepts breaking change marker with no scope', () => {
  const result = validateCommitMessage('feat!: drop v1 tokens');
  assert.equal(result.valid, true);
});

test('rejects a leading emoji even with an otherwise valid subject', () => {
  const result = validateCommitMessage('✨ feat(docker): add health check endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no emoji prefix/i);
});

test('rejects unknown commit type', () => {
  const result = validateCommitMessage('feature(api): add endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /type/i);
});

test('rejects retired "security" type', () => {
  const result = validateCommitMessage('security(api): patch injection vector');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /type/i);
});

test('rejects retired "deps" type', () => {
  const result = validateCommitMessage('deps(app): bump some-dep');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /type/i);
});

test('rejects retired "remove" type', () => {
  const result = validateCommitMessage('remove(api): drop unused v0 endpoints');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /type/i);
});

test('rejects trailing period', () => {
  const result = validateCommitMessage('feat(api): add endpoint.');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /trailing period/i);
});

test('rejects subject longer than 100 characters', () => {
  const longDescription = 'a'.repeat(90);
  const result = validateCommitMessage(`feat(api): ${longDescription}`);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /100 characters/i);
});

test('rejects uppercase-initial description', () => {
  const result = validateCommitMessage('feat(api): Add endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /imperative/i);
});

test('allows auto-generated merge commits', () => {
  const result = validateCommitMessage('Merge pull request #123 from CodesWhat/release/v1.5.0');
  assert.equal(result.valid, true);
});

test('allows default git revert commits', () => {
  const result = validateCommitMessage('Revert "feat(api): add endpoint"');
  assert.equal(result.valid, true);
});

test('allows fixup! autosquash commits', () => {
  const result = validateCommitMessage('fixup! feat(api): add endpoint');
  assert.equal(result.valid, true);
});

test('allows squash! autosquash commits', () => {
  const result = validateCommitMessage('squash! feat(api): add endpoint');
  assert.equal(result.valid, true);
});

test('failure formatter lists the allowed type list with no emoji', () => {
  const result = validateCommitMessage('feature(api): add endpoint');
  const formatted = formatValidationFailure('feature(api): add endpoint', result.errors);
  assert.match(formatted, /Allowed types:/);
  assert.match(formatted, /feat: new feature/);
  assert.match(formatted, /build: build system or dependency change/);
  assert.match(formatted, /ci: CI\/CD configuration change/);
  assert.doesNotMatch(formatted, /✨|🐛|📝|🎨|💄|🔄|♻️|⚡|🧪|✅|🔧|🔒|📦|⬆️|🗑️/u);
});

test('rejects a double space after the colon (leading space would dodge the lowercase check)', () => {
  const result = validateCommitMessage('feat:  Add endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /exactly one space after the colon/i);
});

test('rejects a tab after the colon', () => {
  const result = validateCommitMessage('feat:\tadd endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /exactly one space after the colon/i);
});

test('does not blame spacing when the scope is what is invalid', () => {
  const result = validateCommitMessage('feat(BadScope): add endpoint');
  assert.equal(result.valid, false);
  assert.doesNotMatch(result.errors.join(' '), /exactly one space/i);
});
