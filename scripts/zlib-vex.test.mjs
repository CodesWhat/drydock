import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const document = JSON.parse(
  readFileSync(new URL('../docker/zlib/fixed.vex.json', import.meta.url), 'utf8'),
);

test('the infback9 classification covers only the inspected runtime APK revision', () => {
  const statements = document.statements.filter(
    (entry) => entry.vulnerability.name === 'CVE-2026-4738',
  );
  assert.equal(statements.length, 1);
  const [statement] = statements;
  assert.equal(statement.status, 'not_affected');
  assert.equal(statement.justification, 'vulnerable_code_not_present');
  assert.deepEqual(statement.products, [
    { '@id': 'pkg:apk/alpine/zlib@1.3.2-r2026092401' },
  ]);
  assert.match(statement.impact_statement, /contrib\/infback9/);
  assert.match(statement.impact_statement, /amd64/);
  assert.match(statement.impact_statement, /arm64/);
});

test('the separate gzip-write backport retains its fixed status and exact package scope', () => {
  const statements = document.statements.filter(
    (entry) => entry.vulnerability.name === 'CVE-2026-85091',
  );
  assert.equal(statements.length, 1);
  assert.equal(statements[0].status, 'fixed');
  assert.deepEqual(statements[0].products, [
    { '@id': 'pkg:apk/alpine/zlib@1.3.2-r2026092401' },
  ]);
  assert.equal(document.statements.length, 2);
});
