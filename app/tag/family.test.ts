import { isPinGateGoverned, normalizeTagFamilyPolicy } from './family.js';

describe('tag/family', () => {
  describe('normalizeTagFamilyPolicy', () => {
    test('defaults to strict when the raw policy is undefined', () => {
      expect(normalizeTagFamilyPolicy(undefined)).toBe('strict');
    });

    test('defaults to strict when the raw policy is blank', () => {
      expect(normalizeTagFamilyPolicy('')).toBe('strict');
    });

    test('recognizes loose regardless of surrounding whitespace and case', () => {
      expect(normalizeTagFamilyPolicy('loose')).toBe('loose');
      expect(normalizeTagFamilyPolicy(' LOOSE ')).toBe('loose');
    });

    test('passes through an explicit strict value', () => {
      expect(normalizeTagFamilyPolicy('strict')).toBe('strict');
    });

    test('falls back to strict for invalid values', () => {
      expect(normalizeTagFamilyPolicy('garbage')).toBe('strict');
    });
  });

  describe('isPinGateGoverned', () => {
    test('is true for a specific-precision tag with no include filter and no tagFamily override', () => {
      expect(
        isPinGateGoverned({
          image: { tag: { tagPrecision: 'specific' } },
        }),
      ).toBe(true);
    });

    test('is false when an includeTags filter is set', () => {
      expect(
        isPinGateGoverned({
          includeTags: '^1\\..*$',
          image: { tag: { tagPrecision: 'specific' } },
        }),
      ).toBe(false);
    });

    test('is false when tagFamily is loose', () => {
      expect(
        isPinGateGoverned({
          tagFamily: 'loose',
          image: { tag: { tagPrecision: 'specific' } },
        }),
      ).toBe(false);
    });

    test('is false when tagPrecision is floating', () => {
      expect(
        isPinGateGoverned({
          image: { tag: { tagPrecision: 'floating' } },
        }),
      ).toBe(false);
    });

    test('is false when tagPrecision is absent', () => {
      expect(
        isPinGateGoverned({
          image: { tag: {} },
        }),
      ).toBe(false);
    });

    test('falls back to strict for an invalid tagFamily value, so the gate still governs', () => {
      expect(
        isPinGateGoverned({
          tagFamily: 'garbage',
          image: { tag: { tagPrecision: 'specific' } },
        }),
      ).toBe(true);
    });
  });
});
