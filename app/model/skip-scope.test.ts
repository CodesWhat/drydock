import { describe, expect, test } from 'vitest';
import {
  buildLineSkipEntry,
  filterLineSkippedTags,
  isRejectScope,
  isTagSkipped,
} from './skip-scope.js';

describe('model/skip-scope', () => {
  describe('isRejectScope', () => {
    test.each(['tag', 'minor', 'major'])('accepts %s', (scope) => {
      expect(isRejectScope(scope)).toBe(true);
    });

    test.each(['patch', '', 3, null, undefined])('refuses %j', (scope) => {
      expect(isRejectScope(scope)).toBe(false);
    });
  });

  describe('buildLineSkipEntry', () => {
    test('builds major and minor entries from the tag', () => {
      expect(buildLineSkipEntry('major', '3.4.5', undefined)).toBe('major:3');
      expect(buildLineSkipEntry('minor', 'v3.4.5', undefined)).toBe('minor:3.4');
    });

    test('reads the line from the transformed tag', () => {
      expect(buildLineSkipEntry('minor', 'rel-7.8.9', '^rel-(.*)$ => $1')).toBe('minor:7.8');
    });

    test('returns undefined for a non-semver tag', () => {
      expect(buildLineSkipEntry('major', 'latest', undefined)).toBeUndefined();
    });
  });

  describe('isTagSkipped', () => {
    test('is false without skip entries', () => {
      expect(isTagSkipped('1.0.0', undefined, undefined)).toBe(false);
      expect(isTagSkipped('1.0.0', [], undefined)).toBe(false);
    });

    test('matches an exact entry, including a non-semver tag', () => {
      expect(isTagSkipped('latest', ['latest'], undefined)).toBe(true);
      expect(isTagSkipped('1.0.1', ['1.0.0'], undefined)).toBe(false);
    });

    test('a major entry covers every tag in that major only', () => {
      const skips = ['major:3'];
      expect(isTagSkipped('3.0.0', skips, undefined)).toBe(true);
      expect(isTagSkipped('3.9.4', skips, undefined)).toBe(true);
      expect(isTagSkipped('v3.1.0', skips, undefined)).toBe(true);
      expect(isTagSkipped('2.9.9', skips, undefined)).toBe(false);
      expect(isTagSkipped('4.0.0', skips, undefined)).toBe(false);
      expect(isTagSkipped('30.0.0', skips, undefined)).toBe(false);
    });

    test('a minor entry covers that X.Y line only', () => {
      const skips = ['minor:2.4'];
      expect(isTagSkipped('2.4.0', skips, undefined)).toBe(true);
      expect(isTagSkipped('2.4.9', skips, undefined)).toBe(true);
      expect(isTagSkipped('2.5.0', skips, undefined)).toBe(false);
      expect(isTagSkipped('3.4.0', skips, undefined)).toBe(false);
      expect(isTagSkipped('2.41.0', skips, undefined)).toBe(false);
    });

    test('judges the line on the transformed tag', () => {
      expect(isTagSkipped('rel-3.1.0', ['major:3'], '^rel-(.*)$ => $1')).toBe(true);
      expect(isTagSkipped('rel-4.1.0', ['major:3'], '^rel-(.*)$ => $1')).toBe(false);
    });

    test('a line entry never matches a non-semver tag', () => {
      expect(isTagSkipped('latest', ['major:3'], undefined)).toBe(false);
    });

    test('ignores malformed line-looking entries', () => {
      expect(isTagSkipped('3.0.0', ['major:3.1', 'minor:3', 'major:x', 'major:'], undefined)).toBe(
        false,
      );
    });
  });

  describe('filterLineSkippedTags', () => {
    const tags = ['2.4.1', '2.5.0', '3.0.0', '3.1.0', '4.0.0'];

    test('returns the same list without line entries', () => {
      expect(filterLineSkippedTags(tags, undefined, undefined)).toBe(tags);
      expect(filterLineSkippedTags(tags, ['3.0.0'], undefined)).toBe(tags);
    });

    test('drops a rejected major but keeps older patches and a newer line', () => {
      expect(filterLineSkippedTags(tags, ['major:3'], undefined)).toEqual([
        '2.4.1',
        '2.5.0',
        '4.0.0',
      ]);
    });

    test('drops a rejected minor line only', () => {
      expect(filterLineSkippedTags(tags, ['minor:3.0'], undefined)).toEqual([
        '2.4.1',
        '2.5.0',
        '3.1.0',
        '4.0.0',
      ]);
    });

    test('does not apply exact entries (they suppress after selection)', () => {
      expect(filterLineSkippedTags(tags, ['3.1.0', 'major:4'], undefined)).toEqual([
        '2.4.1',
        '2.5.0',
        '3.0.0',
        '3.1.0',
      ]);
    });
  });
});
