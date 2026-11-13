import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('fast-xml-parser stays above the stop-node advisory floor without a waiver', () => {
  for (const file of ['app/package-lock.json', 'e2e/package-lock.json']) {
    const lock = JSON.parse(read(file));
    const parsers = Object.entries(lock.packages).filter(([path]) =>
      path.endsWith('/fast-xml-parser'),
    );
    assert.ok(parsers.length > 0, `missing parser in ${file}`);
    for (const [path, { version }] of parsers) {
      assert.match(version, /^\d+\.\d+\.\d+$/u);
      const [major, minor] = version.split('.').map(Number);
      assert.ok(major > 5 || (major === 5 && minor >= 12), `${file}:${path} is below 5.12.0`);
    }
  }
  assert.doesNotMatch(read('.qlty/qlty.toml'), /osv-scanner:CVE-2026-126066/u);
});
