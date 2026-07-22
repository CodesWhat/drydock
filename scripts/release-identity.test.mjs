import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BASE_VERSION = '1.6.0';
const RC_VERSION = '1.6.0-rc.4';
const DEMO_RELEASE_FIXTURES = [
  {
    path: 'apps/demo/src/mocks/data/server.ts',
    valuePattern: /\bversion:\s*["']([^"']+)["']/gu,
  },
  {
    path: 'apps/demo/src/mocks/data/agents.ts',
    valuePattern: /\bversion:\s*["']([^"']+)["']/gu,
  },
  {
    path: 'apps/demo/src/mocks/handlers/app.ts',
    valuePattern: /\bversion:\s*["']([^"']+)["']/gu,
  },
  {
    path: 'apps/demo/src/mocks/data/audit.ts',
    valuePattern: /(?:Drydock v|codeswhat\/drydock:)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gu,
  },
  {
    path: 'apps/demo/src/mocks/data/containers.ts',
    valuePattern: /displayName:\s*["']Drydock["'][\s\S]*?\btag:\s*["']([^"']+)["']/gu,
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function versionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^0-9A-Za-z.-])v?${escaped}(?![0-9A-Za-z.-])`, 'u');
}

function extractVersionValues(contents, valuePattern) {
  return [...new Set([...contents.matchAll(valuePattern)].map((match) => match[1]))].sort();
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

test('demo runtime fixtures identify the exact v1.6.0-rc.4 candidate', () => {
  for (const { path, valuePattern } of DEMO_RELEASE_FIXTURES) {
    const contents = readFileSync(path, 'utf8');
    assert.deepEqual(extractVersionValues(contents, valuePattern), [RC_VERSION], path);
  }
});

test('release version patterns match exact optionally v-prefixed tokens', () => {
  const rcPattern = versionPattern(RC_VERSION);
  const legacyPattern = versionPattern('1.5.0');

  assert.match('version: 1.6.0-rc.4', rcPattern);
  assert.match('version: v1.6.0-rc.4', rcPattern);
  assert.doesNotMatch('version: 1.6.0-rc.40', rcPattern);
  assert.doesNotMatch('version: x1.6.0-rc.4', rcPattern);
  assert.match('version: v1.5.0', legacyPattern);
  assert.doesNotMatch('version: 1.5.0-rc.1', legacyPattern);
});

test('fixture version extraction retains mixed candidate identities', () => {
  const contents = "version: '1.6.0-rc.4', version: '1.6.0-rc.40'";
  assert.deepEqual(extractVersionValues(contents, /version:\s*["']([^"']+)["']/gu), [
    '1.6.0-rc.4',
    '1.6.0-rc.40',
  ]);
});
