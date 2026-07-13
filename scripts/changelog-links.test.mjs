import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractChangelogEntry } from './extract-changelog-entry.mjs';

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const repositoryUrl = 'https://github.com/CodesWhat/drydock';

function getLinkDefinitions(markdown) {
  return [...markdown.matchAll(/^\[([^\]]+)\]:\s+(\S+)\s*$/gmu)].map((match) => ({
    label: match[1],
    url: match[2],
  }));
}

function getBulletIdentities(entry) {
  return entry
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.match(/^- \*\*([^*]+)\*\*/u)?.[1] ?? line)
    .sort();
}

test('every linked changelog heading has exactly one link definition', () => {
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gmu)].map((match) => match[1]);
  const definitions = getLinkDefinitions(changelog);
  const counts = new Map();

  assert.equal(
    new Set(headings).size,
    headings.length,
    'every bracketed changelog heading must be unique',
  );
  assert.equal(
    new Set(definitions.map(({ label }) => label)).size,
    definitions.length,
    'every changelog link definition must be unique',
  );
  assert.deepEqual(
    definitions.map(({ label }) => label).filter((label) => !new Set(headings).has(label)),
    [],
    'remove link definitions that do not have a matching changelog heading',
  );

  for (const definition of definitions) {
    counts.set(definition.label, (counts.get(definition.label) ?? 0) + 1);
  }

  assert.deepEqual(
    headings.filter((heading) => counts.get(heading) !== 1),
    [],
    'add one and only one bottom-of-file link definition for every bracketed heading',
  );
});

test('v1.5.2 GA has a complete chronological comparison-link chain', () => {
  const definitions = new Map(getLinkDefinitions(changelog).map(({ label, url }) => [label, url]));
  const expected = new Map([
    ['Unreleased', `${repositoryUrl}/compare/v1.5.2...HEAD`],
    ['1.5.2', `${repositoryUrl}/compare/v1.5.2-rc.5...v1.5.2`],
    ['1.5.2-rc.5', `${repositoryUrl}/compare/v1.5.2-rc.4...v1.5.2-rc.5`],
    ['1.5.2-rc.4', `${repositoryUrl}/compare/v1.5.2-rc.3...v1.5.2-rc.4`],
    ['1.5.2-rc.3', `${repositoryUrl}/compare/v1.5.2-rc.2...v1.5.2-rc.3`],
    ['1.5.2-rc.2', `${repositoryUrl}/compare/v1.5.2-rc.1...v1.5.2-rc.2`],
    ['1.5.2-rc.1', `${repositoryUrl}/compare/v1.5.1...v1.5.2-rc.1`],
    ['1.5.1', `${repositoryUrl}/compare/v1.5.1-rc.6...v1.5.1`],
    ['1.5.1-rc.6', `${repositoryUrl}/compare/v1.5.1-rc.5...v1.5.1-rc.6`],
    ['1.5.1-rc.5', `${repositoryUrl}/compare/v1.5.1-rc.4...v1.5.1-rc.5`],
    ['1.5.1-rc.4', `${repositoryUrl}/compare/v1.5.1-rc.3...v1.5.1-rc.4`],
    ['1.5.1-rc.3', `${repositoryUrl}/compare/v1.5.1-rc.2...v1.5.1-rc.3`],
    ['1.5.1-rc.2', `${repositoryUrl}/compare/v1.5.1-rc.1...v1.5.1-rc.2`],
    ['1.5.1-rc.1', `${repositoryUrl}/compare/v1.5.0...v1.5.1-rc.1`],
  ]);

  for (const [label, expectedUrl] of expected) {
    assert.equal(definitions.get(label), expectedUrl, `incorrect or missing [${label}] link`);
  }
});

test('real changelog exposes nonempty v1.5.2 GA release notes', () => {
  const entry = extractChangelogEntry(changelog, 'v1.5.2');

  assert.match(entry, /^## \[1\.5\.2\] [–—-] \d{4}-\d{2}-\d{2}$/mu);
  assert.match(entry, /Consolidates the `1\.5\.2-rc\.1` … `1\.5\.2-rc\.5` prereleases\./u);
  assert.match(entry, /^### Fixed$/mu);
  assert.match(entry, /^### Changed$/mu);
  assert.doesNotMatch(entry, /^## \[1\.5\.2-rc\.5\]/mu);

  for (const marker of [
    'Container update policy is no longer lost',
    'Pinned semver tags',
    'Informational version visibility',
    'Tooltip text now wraps',
    'Orphaned replacement container',
  ]) {
    assert.ok(entry.includes(marker), `v1.5.2 GA notes must include: ${marker}`);
  }

  const prereleaseBullets = [1, 2, 3, 4, 5]
    .flatMap((releaseCandidate) =>
      getBulletIdentities(extractChangelogEntry(changelog, `v1.5.2-rc.${releaseCandidate}`)),
    )
    .sort();
  assert.deepEqual(
    getBulletIdentities(entry),
    prereleaseBullets,
    'GA notes must contain every rc.1–rc.5 bullet exactly once',
  );
});
