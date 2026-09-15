import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('current Store API example includes the SQLite configuration field', () => {
  const document = readFileSync('content/docs/current/api/store.mdx', 'utf8');
  const example = document.match(/```json\n([\s\S]*?)\n```/u);
  assert.ok(example, 'the API response must be a separate JSON example');
  assert.deepEqual(JSON.parse(example[1]), {
    configuration: { path: '/store', file: 'dd.json', dbFile: 'dd.sqlite' },
  });
});

test('current diagnostic docs describe SQLite aggregate size, not per-collection bytes', () => {
  const document = readFileSync('content/docs/current/api/app.mdx', 'utf8');
  const diagnostics = document.slice(document.indexOf('## Download diagnostic debug dump'));
  assert.match(diagnostics, /SQLite/u);
  assert.match(diagnostics, /page_count/u);
  assert.match(diagnostics, /page_size/u);
  assert.doesNotMatch(diagnostics, /LokiJS|per-collection `serializedBytes`/u);
});
