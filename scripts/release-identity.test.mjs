import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BASE_VERSION = '1.6.0';
const RC_VERSION = '1.6.0-rc.1';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function versionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^0-9A-Za-z.-])v?${escaped}(?![0-9A-Za-z.-])`, 'u');
}

test('release-gated workspace packages and locks use the v1.6 base version', () => {
  for (const workspace of ['.', 'app', 'ui', 'e2e', 'apps/demo']) {
    const prefix = workspace === '.' ? '' : `${workspace}/`;
    const manifest = readJson(`${prefix}package.json`);
    const lock = readJson(`${prefix}package-lock.json`);

    assert.equal(manifest.version, BASE_VERSION, `${prefix}package.json`);
    assert.equal(lock.version, BASE_VERSION, `${prefix}package-lock.json`);
    assert.equal(lock.packages?.['']?.version, BASE_VERSION, `${prefix}package-lock.json root`);
  }
});

test('demo runtime fixtures identify the exact v1.6.0-rc.1 candidate', () => {
  for (const path of [
    'apps/demo/src/mocks/data/server.ts',
    'apps/demo/src/mocks/data/agents.ts',
    'apps/demo/src/mocks/handlers/app.ts',
    'apps/demo/src/mocks/data/audit.ts',
    'apps/demo/src/mocks/data/containers.ts',
  ]) {
    const contents = readFileSync(path, 'utf8');
    assert.match(contents, versionPattern(RC_VERSION), path);
    assert.doesNotMatch(contents, versionPattern('1.5.0'), path);
  }
});

test('release version patterns match exact optionally v-prefixed tokens', () => {
  const rcPattern = versionPattern(RC_VERSION);
  const legacyPattern = versionPattern('1.5.0');

  assert.match('version: 1.6.0-rc.1', rcPattern);
  assert.match('version: v1.6.0-rc.1', rcPattern);
  assert.doesNotMatch('version: 1.6.0-rc.10', rcPattern);
  assert.doesNotMatch('version: x1.6.0-rc.1', rcPattern);
  assert.match('version: v1.5.0', legacyPattern);
  assert.doesNotMatch('version: 1.5.0-rc.1', legacyPattern);
});
