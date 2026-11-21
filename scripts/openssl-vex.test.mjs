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

const notAffected = {
  'CVE-2026-124709': /QUIC server/,
  'CVE-2026-107494': /RETIRE_CONNECTION_ID/,
  'CVE-2026-121482': /CRL/,
  'CVE-2026-84786': /DANE/,
  'CVE-2026-107493': /PEM_X509_INFO_read_bio_ex/,
};

const allProducts = [
  { '@id': 'pkg:apk/alpine/openssl@3.5.9-r1' },
  { '@id': 'pkg:apk/alpine/libssl3@3.5.9-r1' },
  { '@id': 'pkg:apk/alpine/libcrypto3@3.5.9-r1' },
];

test('the OpenSSL classification covers exactly the nine advisories', () => {
  assert.deepEqual(
    document.statements.map((statement) => statement.vulnerability.name).sort(),
    [...Object.keys(reasons), ...Object.keys(notAffected)].sort(),
  );
});

test('each statement is limited to OpenSSL 3.5.9-r1 and names its reason', () => {
  for (const statement of document.statements.filter(
    (candidate) => candidate.vulnerability.name in reasons,
  )) {
    assert.equal(statement.status, 'fixed');
    assert.match(statement.impact_statement, /Alpine fixed this/);
    assert.deepEqual(statement.products, [
      { '@id': 'pkg:apk/alpine/openssl@3.5.9-r1' },
      { '@id': 'pkg:apk/alpine/libssl3@3.5.9-r1' },
      { '@id': 'pkg:apk/alpine/libcrypto3@3.5.9-r1' },
    ]);
    assert.match(statement.impact_statement, reasons[statement.vulnerability.name]);
    assert.match(statement.impact_statement, /No other revision|no other revision/);
    assert.match(statement.impact_statement, /Remove this document/);
  }
});

test('the not-affected statements are scoped, justified and bounded to built-in paths', () => {
  for (const [name, reason] of Object.entries(notAffected)) {
    const statement = document.statements.find(
      (candidate) => candidate.vulnerability.name === name,
    );
    assert.ok(statement, `missing statement for ${name}`);
    assert.equal(statement.status, 'not_affected');
    assert.equal(statement.justification, 'vulnerable_code_not_in_execute_path');
    assert.deepEqual(statement.products, allProducts);
    assert.match(statement.impact_statement, reason);
    assert.match(statement.impact_statement, /built-in image paths only/);
    assert.match(statement.impact_statement, /Command actions/);
    assert.match(statement.impact_statement, /no other revision is/);
    assert.doesNotMatch(statement.impact_statement, /\u2014/);
  }
});
