import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as releasePrecheck from './release-precut-check.mjs';
import {
  formatReport,
  isPrerelease,
  parsePendingReplies,
  versionSeries,
} from './release-precut-check.mjs';

const scriptPath = fileURLToPath(new URL('./release-precut-check.mjs', import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'drydock-precut-test-'));

const agentsGuide = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const releasingGuide = readFileSync(new URL('../RELEASING.md', import.meta.url), 'utf8');
const lefthookConfig = readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8');
const releasePrecheckSource = readFileSync(
  new URL('./release-precut-check.mjs', import.meta.url),
  'utf8',
);

test('contributor guidance documents executable UI lint commands', () => {
  assert.doesNotMatch(agentsGuide, /npm run lint\s+\/\s+lint:fix/u);
  assert.match(agentsGuide, /npm run lint\s+# biome check \./u);
  assert.match(agentsGuide, /npm run lint:fix\s+# biome check --fix \./u);
});

test('contributor guidance matches full pre-push semantics and measured timing', () => {
  const staticAnalysisSection = agentsGuide.match(
    /# Static analysis from repo root[\s\S]*?(?=\n\n# E2E)/u,
  )?.[0];
  assert.ok(staticAnalysisSection, 'AGENTS.md must have a static-analysis command block');
  for (const command of ['qlty', 'qlty-smells']) {
    const run = lefthookConfig.match(new RegExp(`^ {4}${command}:\\n {6}run: (?<run>.+)$`, 'mu'))
      ?.groups?.run;
    assert.ok(run, `lefthook.yml must define the ${command} run command`);
    assert.ok(
      staticAnalysisSection.includes(run),
      `AGENTS.md must document the exact ${command} run command`,
    );
  }
  assert.match(staticAnalysisSection, /qlty-smells-gate\.mjs --scope=all \|\| true\s+# advisory/u);
  assert.match(agentsGuide, /takes about \*\*5 minutes end to end\*\*/u);

  const prePushSection = agentsGuide.match(
    /## Pre-push checks \(Lefthook\)[\s\S]*?(?=\n## Merging)/u,
  )?.[0];
  assert.ok(prePushSection, 'AGENTS.md must have a pre-push section');

  const configuredCommands = lefthookConfig
    .slice(lefthookConfig.indexOf('\npre-push:\n'))
    .matchAll(/^ {4}([a-z][a-z0-9-]+):$/gmu);
  for (const [, command] of configuredCommands) {
    assert.match(prePushSection, new RegExp(`\`${command}\``, 'u'));
  }
});

test('release instructions enumerate every versioned workspace manifest in the precheck', () => {
  const packagePathBlock = releasePrecheckSource.match(
    /const packagePaths = \[(?<paths>[\s\S]*?)\];/u,
  )?.groups?.paths;
  assert.ok(packagePathBlock, 'release precheck must define packagePaths');

  const packagePaths = [...packagePathBlock.matchAll(/'(?<path>(?:[^']*\/)?package\.json)'/gu)].map(
    (match) => match.groups.path,
  );
  const requiredPaths = [
    ...packagePaths,
    ...packagePaths.map((path) => path.replace(/package\.json$/u, 'package-lock.json')),
  ];
  for (const path of requiredPaths) {
    assert.match(releasingGuide, new RegExp(`\`${path.replaceAll('.', '\\.')}\``, 'u'));
  }
});

// ---------------------------------------------------------------------------
// versionSeries
// ---------------------------------------------------------------------------

test('versionSeries extracts major.minor from a stable tag', () => {
  assert.equal(versionSeries('v1.6.0'), '1.6');
});

test('versionSeries extracts major.minor from an rc tag', () => {
  assert.equal(versionSeries('v1.6.0-rc.3'), '1.6');
});

test('versionSeries accepts a tag without a leading v', () => {
  assert.equal(versionSeries('1.6.0'), '1.6');
});

test('versionSeries throws for an invalid tag', () => {
  assert.throws(() => versionSeries('not-a-tag'), /Invalid release tag: not-a-tag/u);
});

// ---------------------------------------------------------------------------
// isPrerelease
// ---------------------------------------------------------------------------

test('isPrerelease returns true for an rc tag', () => {
  assert.equal(isPrerelease('v1.6.0-rc.3'), true);
});

test('isPrerelease returns false for a stable GA tag', () => {
  assert.equal(isPrerelease('v1.6.0'), false);
});

test('release precheck exposes exact repository metadata validation', () => {
  assert.equal(typeof releasePrecheck.validateReleaseMetadata, 'function');
});

function makeReleaseFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drydock-release-metadata-'));
  const files = {
    'package.json': '{"version":"1.7.0"}',
    'package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.7.0"}}}',
    'app/package.json': '{"version":"1.7.0"}',
    'app/package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.7.0"}}}',
    'ui/package.json': '{"version":"1.7.0"}',
    'ui/package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.7.0"}}}',
    'e2e/package.json': '{"version":"1.7.0"}',
    'e2e/package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.7.0"}}}',
    'apps/demo/package.json': '{"version":"1.7.0"}',
    'apps/demo/package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.7.0"}}}',
    'CHANGELOG.md':
      '# Changelog\n\n## [Unreleased]\n\n## [1.7.0-rc.1] — 2026-08-13\n\n### Added\n\n- release work\n',
    'README.md': 'v1.7.0-rc.1 highlights\n',
    'apps/web/scripts/docs-versions.mjs': '{ slug: "v1.7", source: "current", title: "v1.7" }',
    'apps/web/src/lib/site-config.ts': 'version: "1.7.0-rc.1"',
    'content/docs/current/updates/index.mdx':
      '## Unreleased\n\n## v1.7.0-rc.1 Highlights — August 13, 2026\n',
    'content/docs/current/quickstart/index.mdx':
      '| `1.7.0-rc.1` | Immutable release candidate; best for reproducible testing |\n',
    ...overrides,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
  return root;
}

test('release metadata validation accepts an exact RC identity', () => {
  assert.doesNotThrow(() =>
    releasePrecheck.validateReleaseMetadata(makeReleaseFixture(), 'v1.7.0-rc.1'),
  );
});

test('release metadata validation accepts the GA quickstart label for a stable tag', () => {
  const root = makeReleaseFixture({
    'CHANGELOG.md':
      '# Changelog\n\n## [Unreleased]\n\n## [1.7.0] — 2026-08-13\n\n### Added\n\n- release work\n',
    'README.md': 'v1.7.0 highlights\n',
    'apps/web/src/lib/site-config.ts': 'version: "1.7.0"',
    'content/docs/current/updates/index.mdx':
      '## Unreleased\n\n## v1.7.0 Highlights — August 13, 2026\n',
    'content/docs/current/quickstart/index.mdx':
      '| `1.7.0` | Immutable exact GA release; best for reproducible deployments |\n',
  });

  assert.doesNotThrow(() => releasePrecheck.validateReleaseMetadata(root, 'v1.7.0'));
});

test('release metadata validation rejects a stale package base version', () => {
  const root = makeReleaseFixture({ 'app/package.json': '{"version":"1.6.0"}' });
  assert.throws(
    () => releasePrecheck.validateReleaseMetadata(root, 'v1.7.0-rc.1'),
    /app\/package\.json version is 1\.6\.0, expected 1\.7\.0/u,
  );
});

test('release metadata validation rejects a stale lockfile root version', () => {
  const root = makeReleaseFixture({
    'app/package-lock.json': '{"version":"1.6.0","packages":{"":{"version":"1.7.0"}}}',
  });
  assert.throws(
    () => releasePrecheck.validateReleaseMetadata(root, 'v1.7.0-rc.1'),
    /app\/package-lock\.json version is 1\.6\.0, expected 1\.7\.0/u,
  );
});

test('release metadata validation rejects a stale lockfile workspace version', () => {
  const root = makeReleaseFixture({
    'app/package-lock.json': '{"version":"1.7.0","packages":{"":{"version":"1.6.0"}}}',
  });
  assert.throws(
    () => releasePrecheck.validateReleaseMetadata(root, 'v1.7.0-rc.1'),
    /app\/package-lock\.json packages\[""\]\.version is 1\.6\.0, expected 1\.7\.0/u,
  );
});

test('release metadata validation rejects missing exact changelog and public RC identity', () => {
  const root = makeReleaseFixture({
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
    'README.md': 'v1.6.0 highlights\n',
  });
  assert.throws(
    () => releasePrecheck.validateReleaseMetadata(root, 'v1.7.0-rc.1'),
    /CHANGELOG\.md has no non-empty \[1\.7\.0-rc\.1\] entry[\s\S]*README\.md/u,
  );
});

// ---------------------------------------------------------------------------
// parsePendingReplies
// ---------------------------------------------------------------------------

const SAMPLE_MARKDOWN = `
# Pull-Forward Triage

| Disc | Feature | Effort | Pull-fwd | Notes | Discussion reply status |
| --- | --- | --- | --- | --- | --- |
| #242 | Mobile-friendly views | M | High | promote to v1.6 | ☑ "scheduled v1.6" reply posted; ☐ "shipped in v1.6" reply on release |
| #209 | **Separate Tag + Version columns** | S | Med | promote | ☑ "scheduled v1.6" reply posted; ☐ "shipped in v1.6" on release |
| #210 | Bidirectional MQTT | M | Med | v1.6 Phase | ☑ already replied; ☑ shipped in v1.6 |
| #999 | Some v1.7 feature | M | Low | future | ☑ "scheduled v1.7" reply posted; ☐ "shipped in v1.7" reply on release |

## Issue Triage

| Issue | Lane | Status | Next action |
| --- | --- | --- | --- |
| #386 | Agent | fixed-pending-release | SOAK RISK — hold open. |
| #290 | Notifications | fixed-pending-release | Ping reporter. |
`.trim();

test('parsePendingReplies returns rows with unchecked shipped-in box matching the tag series', () => {
  const result = parsePendingReplies(SAMPLE_MARKDOWN, 'v1.6.0');
  assert.deepEqual(result, [
    { discussion: 242, feature: 'Mobile-friendly views' },
    { discussion: 209, feature: 'Separate Tag + Version columns' },
  ]);
});

test('parsePendingReplies does not return rows where shipped-in box is already checked', () => {
  const result = parsePendingReplies(SAMPLE_MARKDOWN, 'v1.6.0');
  const nums = result.map((r) => r.discussion);
  assert.equal(nums.includes(210), false);
});

test('parsePendingReplies does not return rows from a different version series', () => {
  const result = parsePendingReplies(SAMPLE_MARKDOWN, 'v1.6.0');
  const nums = result.map((r) => r.discussion);
  assert.equal(nums.includes(999), false);
});

test('parsePendingReplies does not return issue-triage rows that have no shipped-in token', () => {
  const result = parsePendingReplies(SAMPLE_MARKDOWN, 'v1.6.0');
  const nums = result.map((r) => r.discussion);
  assert.equal(nums.includes(386), false);
  assert.equal(nums.includes(290), false);
});

test('parsePendingReplies de-duplicates by discussion number', () => {
  const duped = `
| Disc | Feature | Status |
| --- | --- | --- |
| #242 | Mobile-friendly views | ☐ "shipped in v1.6" reply |
| #242 | Mobile-friendly views (dup) | ☐ "shipped in v1.6" reply |
`.trim();
  const result = parsePendingReplies(duped, 'v1.6.0');
  assert.equal(result.length, 1);
  assert.equal(result[0].discussion, 242);
});

test('parsePendingReplies returns empty array when no pending replies match', () => {
  const result = parsePendingReplies(SAMPLE_MARKDOWN, 'v2.0.0');
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

test('formatReport returns the success line when pending is empty', () => {
  const report = formatReport([], 'v1.6.0');
  assert.equal(report, '✓ No pending discussion replies for v1.6.0.');
});

test('formatReport uses singular "discussion" for a single item', () => {
  const report = formatReport([{ discussion: 242, feature: 'Mobile-friendly views' }], 'v1.6.0');
  assert.match(report, /1 discussion still needs/u);
  assert.match(report, /#242 Mobile-friendly views/u);
});

test('formatReport uses plural "discussions" for multiple items', () => {
  const report = formatReport(
    [
      { discussion: 242, feature: 'Mobile-friendly views' },
      { discussion: 209, feature: 'Tag + Version columns' },
    ],
    'v1.6.0',
  );
  assert.match(report, /2 discussions still need/u);
  assert.match(report, / {3}#242 Mobile-friendly views/u);
  assert.match(report, / {3}#209 Tag \+ Version columns/u);
});

test('formatReport includes the tag in the pending header', () => {
  const report = formatReport([{ discussion: 1, feature: 'Foo' }], 'v1.6.0');
  assert.match(report, /"shipped in v1\.6\.0"/u);
});

// ---------------------------------------------------------------------------
// CLI (spawnSync) tests
// ---------------------------------------------------------------------------

const TRACKER_WITH_PENDING = `
| Disc | Feature | Notes |
| --- | --- | --- |
| #242 | Mobile-friendly views | ☐ "shipped in v1.7" reply on release |
`.trim();

const TRACKER_ALL_CLEAR = `
| Disc | Feature | Notes |
| --- | --- | --- |
| #242 | Mobile-friendly views | ☑ shipped in v1.7 |
`.trim();

test('cli exits 1 and reports pending discussion when strict RC check has an unchecked reply', () => {
  const trackerPath = join(tmpDir, 'pending-ga.md');
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, '--strict', 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /#242/u);
});

test('cli exits 0 when --force is set even with pending replies', () => {
  const trackerPath = join(tmpDir, 'pending-force.md');
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, '--strict', '--force', 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
});

test('cli exits 0 with warning when tracker file does not exist', () => {
  const trackerPath = join(tmpDir, 'missing.md');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /Tracker not found at/u);
});

test('cli exits 0 for prerelease tags with pending replies (informational only)', () => {
  const trackerPath = join(tmpDir, 'pending-rc.md');
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
});

test('cli exits 1 for prerelease tags with --strict and pending replies', () => {
  const trackerPath = join(tmpDir, 'pending-rc-strict.md');
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, '--strict', 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
});

test('cli exits 0 and prints success when tracker has no pending replies', () => {
  const trackerPath = join(tmpDir, 'clear.md');
  writeFileSync(trackerPath, TRACKER_ALL_CLEAR, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, 'v1.7.0-rc.2'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No pending discussion replies/u);
});

test('cli exits 1 with error message when no tag is provided', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /release tag is required/u);
});
