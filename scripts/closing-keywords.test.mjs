import assert from 'node:assert/strict';
import test from 'node:test';
import { findClosingKeywords, formatFailure } from './closing-keywords.mjs';

const hits = (text) => findClosingKeywords(text).map((hit) => hit.text);

test('finds every closing keyword form followed by an issue reference', () => {
  for (const word of [
    'close',
    'closes',
    'closed',
    'fix',
    'fixes',
    'fixed',
    'resolve',
    'resolves',
    'resolved',
  ]) {
    assert.equal(hits(`${word} #565`).length, 1, word);
  }
});

test('matches with or without a colon, any case, and cross-repo references', () => {
  assert.deepEqual(hits('Fixes: #1070'), ['Fixes: #1070']);
  assert.deepEqual(hits('FIXES #12'), ['FIXES #12']);
  assert.deepEqual(hits('closes:#7'), ['closes:#7']);
  assert.deepEqual(hits('Resolves CodesWhat/drydock#565'), ['Resolves CodesWhat/drydock#565']);
});

test('matches issue URLs', () => {
  assert.equal(hits('Fixes https://github.com/CodesWhat/drydock/issues/565').length, 1);
});

test('reports the 1-based line of each hit', () => {
  const found = findClosingKeywords('* a change (#1)\n\nbody\nFixes: #9\nCloses #10');
  assert.deepEqual(
    found.map((hit) => hit.line),
    [4, 5],
  );
});

test('ignores plain references and conventional commit subjects', () => {
  assert.deepEqual(hits('fix(auth): close stream leftovers (#1340)'), []);
  assert.deepEqual(hits('fix: resolve socket EACCES (#38)'), []);
  assert.deepEqual(hits('Refs #565 and see #566'), []);
  assert.deepEqual(hits('prefix #12 and suffixes #3 and disclosed #4'), []);
  assert.deepEqual(hits('closes the loop'), []);
  assert.deepEqual(hits(''), []);
  assert.deepEqual(hits(undefined), []);
});

test('formatFailure names each source and hit', () => {
  const message = formatFailure([{ source: 'PR body', line: 4, text: 'Fixes: #9' }]);
  assert.match(message, /PR body:4/);
  assert.match(message, /Fixes: #9/);
});
