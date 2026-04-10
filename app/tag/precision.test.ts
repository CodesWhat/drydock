import { classifyTagPrecision, getNumericTagShape, isTagPinned } from './precision.js';

describe('tag/precision', () => {
  describe('getNumericTagShape', () => {
    test('extracts prefix, numeric segments, and suffix from numeric tags', () => {
      expect(getNumericTagShape('v1.2.3-alpine', undefined)).toEqual({
        prefix: 'v',
        numericSegments: ['1', '2', '3'],
        suffix: '-alpine',
      });
    });

    test('applies tag transforms before extracting the numeric shape', () => {
      expect(
        getNumericTagShape('release-1.2.3-build7', '^(release-\\d+\\.\\d+\\.\\d+)-.*$ => $1'),
      ).toEqual({
        prefix: 'release-',
        numericSegments: ['1', '2', '3'],
        suffix: '',
      });
    });

    test('returns null when the transformed tag contains no digits', () => {
      expect(getNumericTagShape('latest', undefined)).toBeNull();
    });

    test('returns null when the transformed tag contains line breaks', () => {
      expect(getNumericTagShape('1.2.3', '^.*$ => stable\n1.2.3')).toBeNull();
    });
  });

  describe('classifyTagPrecision', () => {
    test('classifies tags with three numeric segments as specific', () => {
      expect(classifyTagPrecision('1.2.3', undefined)).toBe('specific');
    });

    test('classifies tags with fewer than three numeric segments as floating', () => {
      expect(classifyTagPrecision('1.2', undefined, { major: 1, minor: 2, patch: 0 })).toBe(
        'floating',
      );
    });

    test('classifies invalid parsed tags as floating even when digits are present', () => {
      expect(classifyTagPrecision('build-2024', undefined, null)).toBe('floating');
    });

    test('uses transformed tag shape when classifying precision', () => {
      expect(
        classifyTagPrecision('release-1.2.3-build7', '^(release-\\d+\\.\\d+\\.\\d+)-.*$ => $1', {
          major: 1,
          minor: 2,
          patch: 3,
        }),
      ).toBe('specific');
    });
  });

  describe('isTagPinned', () => {
    test('treats numeric version aliases as pinned', () => {
      expect(isTagPinned('16-alpine', undefined)).toBe(true);
      expect(isTagPinned('1.4', undefined)).toBe(true);
      expect(isTagPinned('v3', undefined)).toBe(true);
      expect(isTagPinned('1.2.3', undefined)).toBe(true);
    });

    test('treats rolling channel aliases as not pinned', () => {
      expect(isTagPinned('latest', undefined)).toBe(false);
      expect(isTagPinned('stable', undefined)).toBe(false);
    });
  });
});
