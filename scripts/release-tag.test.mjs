import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseReleaseTag } from './release-tag.mjs';

const scriptPath = fileURLToPath(new URL('./release-tag.mjs', import.meta.url));

test('parses stable release tags', () => {
  assert.deepEqual(parseReleaseTag('v1.5.0'), {
    tag: 'v1.5.0',
    baseVersion: '1.5.0',
    prerelease: null,
    isPrerelease: false,
  });
});

test('parses canonical rc prerelease tags', () => {
  assert.deepEqual(parseReleaseTag('v1.5.0-rc.2'), {
    tag: 'v1.5.0-rc.2',
    baseVersion: '1.5.0',
    prerelease: 'rc.2',
    isPrerelease: true,
  });
});

test('parses non-rc prerelease tags', () => {
  assert.deepEqual(parseReleaseTag('v1.5.0-nightly.20260329.1'), {
    tag: 'v1.5.0-nightly.20260329.1',
    baseVersion: '1.5.0',
    prerelease: 'nightly.20260329.1',
    isPrerelease: true,
  });
});

test('rejects legacy rc tags without a dot-separated numeric identifier', () => {
  assert.throws(
    () => parseReleaseTag('v1.5.0-rc2'),
    /Invalid RC tag format: v1\.5\.0-rc2\. Use v1\.5\.0-rc\.2 instead\./u,
  );
});

test('cli prints release tag metadata for workflows', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--tag', 'v1.5.0-rc.2'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'base_version=1.5.0\nis_prerelease=true\nprerelease=rc.2\n');
});

test('cli fails with a canonical rc correction for legacy rc tags', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--tag', 'v1.5.0-rc2'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Invalid RC tag format: v1\.5\.0-rc2\. Use v1\.5\.0-rc\.2 instead\./u,
  );
});
