import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditEntries } from '../apps/demo/src/mocks/data/audit.ts';

const BASE_VERSION = '1.7.0';
const RC_VERSION = '1.7.0-rc.15';
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

test('release-gated workspace packages and locks use the v1.7 base version', () => {
  for (const workspace of ['.', 'app', 'ui', 'e2e', 'apps/demo']) {
    const prefix = workspace === '.' ? '' : `${workspace}/`;
    const manifest = readJson(`${prefix}package.json`);
    const lock = readJson(`${prefix}package-lock.json`);

    assert.equal(manifest.version, BASE_VERSION, `${prefix}package.json`);
    assert.equal(lock.version, BASE_VERSION, `${prefix}package-lock.json`);
    assert.equal(lock.packages?.['']?.version, BASE_VERSION, `${prefix}package-lock.json root`);
  }
});

test(`demo runtime fixtures identify the exact v${RC_VERSION} candidate`, () => {
  for (const { path, valuePattern } of DEMO_RELEASE_FIXTURES) {
    const contents = readFileSync(path, 'utf8');
    assert.deepEqual(extractVersionValues(contents, valuePattern), [RC_VERSION], path);
  }
});

test('candidate audit events use the exact changelog release day', () => {
  const headingPrefix = `## [${RC_VERSION}] — `;
  const releaseHeading = readFileSync('CHANGELOG.md', 'utf8')
    .split('\n')
    .find((line) => line.startsWith(headingPrefix));
  assert.ok(releaseHeading, 'the exact candidate changelog heading must exist');
  const releaseDay = releaseHeading.slice(headingPrefix.length);
  assert.match(releaseDay, /^\d{4}-\d{2}-\d{2}$/u);
  const candidateEntries = auditEntries.filter((entry) =>
    versionPattern(RC_VERSION).test(entry.details),
  );
  assert.equal(candidateEntries.length, 2);
  for (const entry of candidateEntries) {
    assert.equal(entry.timestamp.slice(0, 10), releaseDay, entry.id);
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)), entry.id);
  }
});

test('candidate startup and watch events lead the audit fixture newest first', () => {
  const [watch, startup] = auditEntries;
  assert.equal(watch.id, 'aud-030');
  assert.equal(startup.id, 'aud-001');
  assert.ok(Date.parse(watch.timestamp) > Date.parse(startup.timestamp));
});

test('release version patterns match exact optionally v-prefixed tokens', () => {
  const rcPattern = versionPattern(RC_VERSION);
  const legacyPattern = versionPattern('1.5.0');

  assert.match(`version: ${RC_VERSION}`, rcPattern);
  assert.match(`version: v${RC_VERSION}`, rcPattern);
  assert.doesNotMatch(`version: ${RC_VERSION}0`, rcPattern);
  assert.doesNotMatch(`version: x${RC_VERSION}`, rcPattern);
  assert.match('version: v1.5.0', legacyPattern);
  assert.doesNotMatch('version: 1.5.0-rc.1', legacyPattern);
});

test('fixture version extraction retains mixed candidate identities', () => {
  const contents = `version: '${RC_VERSION}', version: '${RC_VERSION}0'`;
  assert.deepEqual(extractVersionValues(contents, /version:\s*["']([^"']+)["']/gu), [
    RC_VERSION,
    `${RC_VERSION}0`,
  ]);
});
