import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('the infback9 classification is limited to the inspected Alpine zlib revision', () => {
  const document = JSON.parse(
    readFileSync(new URL('../docker/zlib-infback9.vex.json', import.meta.url), 'utf8'),
  );
  assert.equal(document.statements.length, 1);
  const [statement] = document.statements;
  assert.equal(statement.vulnerability.name, 'CVE-2026-4738');
  assert.equal(statement.status, 'not_affected');
  assert.equal(statement.justification, 'vulnerable_code_not_present');
  assert.deepEqual(statement.products, [{ '@id': 'pkg:apk/alpine/zlib@1.3.2-r1' }]);
  assert.match(statement.impact_statement, /contrib\/infback9/);
  assert.match(statement.impact_statement, /amd64/);
  assert.match(statement.impact_statement, /arm64/);
});

test('Grype loads the scoped document without package or location ignore rules', () => {
  const configuration = readFileSync(new URL('../.grype.yaml', import.meta.url), 'utf8');
  const policy = parse(configuration);
  assert.deepEqual(policy['vex-documents'], ['docker/zlib-infback9.vex.json']);
  assert.equal(policy.ignore, undefined);
});
