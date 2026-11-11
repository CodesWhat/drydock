import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the stop-node advisory classification stays scoped to inspected dependencies and callers', () => {
  const app = JSON.parse(read('app/package-lock.json'));
  const e2e = JSON.parse(read('e2e/package-lock.json'));
  assert.equal(app.packages['node_modules/fast-xml-parser'].version, '5.11.1');
  assert.equal(e2e.packages['node_modules/fast-xml-parser'].version, '5.11.2');
  const parser = read('app/api/icons/svg.ts').match(/new XMLParser\(\{([\s\S]*?)\}\)/u);
  assert.ok(parser, 'reassess the advisory when parser construction changes');
  assert.doesNotMatch(parser[1], /stopNodes/u);
  const config = read('.qlty/qlty.toml');
  assert.match(
    config,
    /match.rules = \["osv-scanner:CVE-2026-126066"\]\nmatch.file_patterns = \["app\/package-lock.json", "e2e\/package-lock.json"\]/u,
  );
});
