import assert from 'node:assert/strict';
import test from 'node:test';
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
