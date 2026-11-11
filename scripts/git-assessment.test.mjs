import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the Git assessment identifies only the promoted images and exact vulnerable packages', () => {
  const document = JSON.parse(
    readFileSync(new URL('../docker/git-merge.vex.json', import.meta.url), 'utf8'),
  );
  assert.equal(document.statements.length, 1);
  const [statement] = document.statements;
  assert.equal(statement.vulnerability.name, 'CVE-2026-105437');
  assert.equal(statement.status, 'affected');
  assert.equal(statement.justification, undefined);
  assert.equal(statement.products.length, 3);
  for (const product of statement.products) {
    assert.match(product['@id'], /^pkg:oci\/drydock@sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(product.subcomponents, [
      { '@id': 'pkg:apk/alpine/git@2.54.0-r0' },
      { '@id': 'pkg:apk/alpine/git-init-template@2.54.0-r0' },
    ]);
  }
  assert.match(statement.action_statement, /custom commands/iu);
  assert.match(statement.action_statement, /Git 2.54.0.*vulnerable/u);
});
