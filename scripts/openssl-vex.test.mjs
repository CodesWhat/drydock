import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const document = JSON.parse(
  readFileSync(new URL('../docker/openssl-3.5.9.vex.json', import.meta.url), 'utf8'),
);

const reasons = {
  'CVE-2026-107496': /CMS_encrypt/,
  'CVE-2026-88823': /GCM-SIV/,
  'CVE-2026-95691': /QUIC/,
  'CVE-2026-95692': /GCM-SIV/,
};

test('the OpenSSL classification covers exactly the four advisories', () => {
  assert.deepEqual(
    document.statements.map((statement) => statement.vulnerability.name).sort(),
    Object.keys(reasons).sort(),
  );
});

test('each statement is limited to OpenSSL 3.5.9-r0 and names its reason', () => {
  for (const statement of document.statements) {
    assert.equal(statement.status, 'not_affected');
    assert.equal(statement.justification, 'vulnerable_code_not_in_execute_path');
    assert.deepEqual(statement.products, [
      { '@id': 'pkg:apk/alpine/openssl@3.5.9-r0' },
      { '@id': 'pkg:apk/alpine/libssl3@3.5.9-r0' },
      { '@id': 'pkg:apk/alpine/libcrypto3@3.5.9-r0' },
    ]);
    assert.match(statement.impact_statement, reasons[statement.vulnerability.name]);
    assert.match(statement.impact_statement, /No other revision|no other revision/);
    assert.match(statement.impact_statement, /Remove this document/);
  }
});
