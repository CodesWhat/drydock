import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  formatReport,
  isPrerelease,
  parsePendingReplies,
  versionSeries,
} from './release-precut-check.mjs';

const scriptPath = fileURLToPath(new URL('./release-precut-check.mjs', import.meta.url));

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
| #242 | Mobile-friendly views | ☐ "shipped in v1.6" reply on release |
`.trim();

const TRACKER_ALL_CLEAR = `
| Disc | Feature | Notes |
| --- | --- | --- |
| #242 | Mobile-friendly views | ☑ shipped in v1.6 |
`.trim();

test('cli exits 1 and reports pending discussion when tracker has unchecked reply (GA tag)', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-${process.pid}.md`);
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(process.execPath, [scriptPath, '--tracker', trackerPath, 'v1.6.0'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /#242/u);
});

test('cli exits 0 when --force is set even with pending replies', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-force-${process.pid}.md`);
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, '--force', 'v1.6.0'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
});

test('cli exits 0 with warning when tracker file does not exist', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-missing-${process.pid}.md`);

  const result = spawnSync(process.execPath, [scriptPath, '--tracker', trackerPath, 'v1.6.0'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /Tracker not found at/u);
});

test('cli exits 0 for prerelease tags with pending replies (informational only)', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-rc-${process.pid}.md`);
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, 'v1.6.0-rc.3'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
});

test('cli exits 1 for prerelease tags with --strict and pending replies', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-rc-strict-${process.pid}.md`);
  writeFileSync(trackerPath, TRACKER_WITH_PENDING, 'utf8');

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--tracker', trackerPath, '--strict', 'v1.6.0-rc.3'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
});

test('cli exits 0 and prints success when tracker has no pending replies', () => {
  const trackerPath = join(tmpdir(), `drydock-precut-test-clear-${process.pid}.md`);
  writeFileSync(trackerPath, TRACKER_ALL_CLEAR, 'utf8');

  const result = spawnSync(process.execPath, [scriptPath, '--tracker', trackerPath, 'v1.6.0'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

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
