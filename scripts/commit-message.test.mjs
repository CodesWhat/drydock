import assert from 'node:assert/strict';
import test from 'node:test';
import { formatValidationFailure, validateCommitMessage } from './commit-message.mjs';

test('accepts a valid feat message with scope', () => {
  const result = validateCommitMessage('✨ feat(docker): add health check endpoint');
  assert.equal(result.valid, true);
});

test('accepts a valid fix message without scope', () => {
  const result = validateCommitMessage('🐛 fix: resolve socket EACCES (#38)');
  assert.equal(result.valid, true);
});

test('accepts primary style emoji 🎨', () => {
  const result = validateCommitMessage('🎨 style(ui): align button padding');
  assert.equal(result.valid, true);
});

test('accepts legacy style emoji 💄 as alias', () => {
  const result = validateCommitMessage('💄 style(ui): align button padding');
  assert.equal(result.valid, true);
});

test('accepts primary refactor emoji 🔄', () => {
  const result = validateCommitMessage('🔄 refactor(api): split handlers module');
  assert.equal(result.valid, true);
});

test('accepts legacy refactor emoji ♻️ as alias', () => {
  const result = validateCommitMessage('♻️ refactor(api): split handlers module');
  assert.equal(result.valid, true);
});

test('accepts primary test emoji 🧪', () => {
  const result = validateCommitMessage('🧪 test(store): cover migration branch');
  assert.equal(result.valid, true);
});

test('accepts legacy test emoji ✅ as alias', () => {
  const result = validateCommitMessage('✅ test(store): cover migration branch');
  assert.equal(result.valid, true);
});

test('accepts primary deps emoji 📦', () => {
  const result = validateCommitMessage('📦 deps(app): update axios 1.13 → 1.15');
  assert.equal(result.valid, true);
});

test('accepts legacy deps emoji ⬆️ as alias', () => {
  const result = validateCommitMessage('⬆️ deps(app): update axios 1.13 → 1.15');
  assert.equal(result.valid, true);
});

test('accepts remove type with 🗑️ emoji', () => {
  const result = validateCommitMessage('🗑️ remove(api): drop unused v0 endpoints');
  assert.equal(result.valid, true);
});

test('accepts revert type with 🗑️ emoji', () => {
  const result = validateCommitMessage('🗑️ revert(ui): back out flaky dashboard widget');
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

test('rejects foreign emoji for a type that has an alias set', () => {
  // 🎨 is a valid known emoji (style), but deps only accepts 📦 and ⬆️
  const result = validateCommitMessage('🎨 deps(app): bump some-dep');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /emoji\/type pair/i);
});

test('rejects trailing period', () => {
  const result = validateCommitMessage('✨ feat(api): add endpoint.');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /trailing period/i);
});

test('rejects subject longer than 100 characters', () => {
  const longDescription = 'a'.repeat(90);
  const result = validateCommitMessage(`✨ feat(api): ${longDescription}`);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /100 characters/i);
});

test('rejects uppercase-initial description', () => {
  const result = validateCommitMessage('✨ feat(api): Add endpoint');
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /imperative/i);
});

test('allows auto-generated merge commits', () => {
  const result = validateCommitMessage('Merge pull request #123 from CodesWhat/release/v1.5.0');
  assert.equal(result.valid, true);
});

test('allows default git revert commits', () => {
  const result = validateCommitMessage('Revert "✨ feat(api): add endpoint"');
  assert.equal(result.valid, true);
});

test('failure formatter lists alias emojis in the allowed pairs list', () => {
  const result = validateCommitMessage('feat(api): add endpoint');
  const formatted = formatValidationFailure('feat(api): add endpoint', result.errors);
  assert.match(formatted, /🎨 style.*💄 style/u);
  assert.match(formatted, /🔄 refactor.*♻️ refactor/u);
  assert.match(formatted, /🧪 test.*✅ test/u);
  assert.match(formatted, /📦 deps.*⬆️ deps/u);
});
