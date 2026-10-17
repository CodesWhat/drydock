import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as extractor from './extract-changelog-entry.mjs';
import { extractChangelogEntry } from './extract-changelog-entry.mjs';

const SAMPLE_CHANGELOG = `# Changelog

## [1.4.2] - 2026-03-15

### Added
- add release automation

## [1.4.1] - 2026-03-10

### Fixed
- fix a regression
`;

test('extracts section for a specific version', () => {
  const entry = extractChangelogEntry(SAMPLE_CHANGELOG, '1.4.1');
  assert.match(entry, /## \[1\.4\.1\] - 2026-03-10/u);
  assert.match(entry, /fix a regression/u);
  assert.doesNotMatch(entry, /1\.4\.2/u);
});

test('accepts version with a leading v', () => {
  const entry = extractChangelogEntry(SAMPLE_CHANGELOG, 'v1.4.2');
  assert.match(entry, /## \[1\.4\.2\] - 2026-03-15/u);
});

test('throws when version is not found', () => {
  assert.throws(
    () => extractChangelogEntry(SAMPLE_CHANGELOG, '9.9.9'),
    /not found.*available versions/i,
  );
});

test('throws when matched version heading does not use YYYY-MM-DD date', () => {
  const invalidDateChangelog = `# Changelog

## [1.4.2] - TBD

### Added
- add release automation
`;

  assert.throws(() => extractChangelogEntry(invalidDateChangelog, '1.4.2'), /YYYY-MM-DD/u);
});

test('accepts em-dash separator in heading', () => {
  const emDashChangelog = `# Changelog

## [1.5.0-rc.11] \u2014 2026-04-21

### Added
- thing
`;
  const entry = extractChangelogEntry(emDashChangelog, 'v1.5.0-rc.11');
  assert.match(entry, /\[1\.5\.0-rc\.11\]/u);
  assert.match(entry, /thing/u);
});

test('accepts en-dash separator in heading', () => {
  const enDashChangelog = `# Changelog

## [1.2.3] \u2013 2026-01-02

### Fixed
- bug
`;
  const entry = extractChangelogEntry(enDashChangelog, '1.2.3');
  assert.match(entry, /\[1\.2\.3\]/u);
});

const summaryStart = '<!-- release-summary:start -->';
const summaryEnd = '<!-- release-summary:end -->';
const withSummary = `## [1.8.0-rc.1] - 2026-10-17

> [!WARNING]
> Back up the complete store. Downgrading restores the snapshot only.

${summaryStart}
### Release highlights
- Compact operator summary.
[Full changelog](https://github.com/CodesWhat/drydock/blob/v1.8.0-rc.1/CHANGELOG.md)
${summaryEnd}

### Added
- Detailed development history that stays in the full changelog.
`;

test('release mode preserves the heading and leading warning while selecting the explicit summary', () => {
  const notes = extractor.extractReleaseNotes(withSummary, 'v1.8.0-rc.1');
  assert.match(notes, /^## \[1\.8\.0-rc\.1\] - 2026-10-17/u);
  assert.match(notes, /> \[!WARNING\]/u);
  assert.match(notes, /snapshot only/u);
  assert.ok(notes.includes('snapshot only.\n\n### Release highlights'));
  assert.match(notes, /Compact operator summary/u);
  assert.match(notes, /Full changelog/u);
  assert.doesNotMatch(notes, /Detailed development history|release-summary:/u);
  assert.match(extractChangelogEntry(withSummary, '1.8.0-rc.1'), /Detailed development history/u);
});

test('release mode keeps an unmarked short historical entry intact', () => {
  assert.equal(
    extractor.extractReleaseNotes(SAMPLE_CHANGELOG, '1.4.2'),
    extractChangelogEntry(SAMPLE_CHANGELOG, '1.4.2'),
  );
});

for (const [name, value] of [
  ['missing end', withSummary.replace(summaryEnd, '')],
  ['missing start', withSummary.replace(summaryStart, '')],
  ['duplicate start', withSummary.replace(summaryStart, `${summaryStart}\n${summaryStart}`)],
  ['duplicate end', withSummary.replace(summaryEnd, `${summaryEnd}\n${summaryEnd}`)],
  ['reversed', `## [1.8.0-rc.1] - 2026-10-17\n${summaryEnd}\ntext\n${summaryStart}`],
  ['empty', `## [1.8.0-rc.1] - 2026-10-17\n${summaryStart}\n \n${summaryEnd}`],
]) {
  test(`release mode rejects a ${name} summary`, () => {
    assert.throws(() => extractor.extractReleaseNotes(value, '1.8.0-rc.1'), /summary/i);
  });
}

test('release mode rejects oversized entries and summaries without truncating warnings', () => {
  const large = `## [1.8.0-rc.1] - 2026-10-17\n\n${'x'.repeat(100001)}`;
  assert.throws(() => extractor.extractReleaseNotes(large, '1.8.0-rc.1'), /100000/u);
  const largeSummary = withSummary.replace('Compact operator summary.', 'x'.repeat(100001));
  assert.throws(() => extractor.extractReleaseNotes(largeSummary, '1.8.0-rc.1'), /100000/u);
});

test('the real RC release-mode output fits its budget and retains SQLite downgrade warnings', () => {
  const notes = execFileSync(
    process.execPath,
    ['scripts/extract-changelog-entry.mjs', '--version', 'v1.8.0-rc.1', '--format', 'release'],
    { encoding: 'utf8' },
  );
  assert.ok(notes.length <= 100000, `Release entry has ${notes.length} characters`);
  assert.match(notes, /> \[!WARNING\]/u);
  assert.match(notes, /back up the complete store/u);
  assert.match(notes, /changes made only in SQLite are not carried back/u);
  assert.match(notes, /Full (?:release notes|changelog)/u);
  assert.ok(
    extractChangelogEntry(readFileSync('CHANGELOG.md', 'utf8'), '1.8.0-rc.1').length > 125000,
  );
});

test('the retained rc.24 extractor accepts the valued release format argument unchanged', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'retained-release-extract-')));
  try {
    mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
    for (const name of ['scripts/extract-changelog-entry.mjs', 'scripts/lib/parse-args.mjs']) {
      writeFileSync(join(dir, name), execFileSync('git', ['show', `v1.7.0-rc.24:${name}`]));
    }
    const changelog = '## [1.7.0] - 2026-10-19\n\n- Retained exact candidate promotion.\n';
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
    const result = execFileSync(
      process.execPath,
      [
        join(dir, 'scripts/extract-changelog-entry.mjs'),
        '--version',
        'v1.7.0',
        '--file',
        join(dir, 'CHANGELOG.md'),
        '--format',
        'release',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.trim(), changelog.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects an unknown output mode', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['scripts/extract-changelog-entry.mjs', '--version', 'v1.8.0-rc.1', '--format', 'unknown'],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    /Unsupported output format/u,
  );
});
