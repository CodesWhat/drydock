import { isThresholdReached, parseThresholdWithDigestBehavior } from './trigger-threshold.js';

describe('trigger-threshold', () => {
  test('parseThresholdWithDigestBehavior should default to all when threshold is undefined', () => {
    expect(parseThresholdWithDigestBehavior(undefined)).toEqual({
      thresholdBase: 'all',
      nonDigestOnly: false,
    });
  });

  test('parseThresholdWithDigestBehavior should split -no-digest suffix', () => {
    expect(parseThresholdWithDigestBehavior('minor-no-digest')).toEqual({
      thresholdBase: 'minor',
      nonDigestOnly: true,
    });
  });

  test('isThresholdReached should return true for unknown update kind when threshold is all', () => {
    expect(
      isThresholdReached(
        {
          updateKind: {
            kind: 'unknown',
            semverDiff: undefined,
          },
        },
        'all',
      ),
    ).toBe(true);
  });

  test('isThresholdReached should return false for unknown update kind when threshold is not all', () => {
    expect(
      isThresholdReached(
        {
          updateKind: {
            kind: 'unknown',
            semverDiff: undefined,
          },
        },
        'minor',
      ),
    ).toBe(false);
  });

  test('isThresholdReached should filter digest updates for non-digest-only thresholds', () => {
    expect(
      isThresholdReached(
        {
          updateKind: {
            kind: 'digest',
            semverDiff: 'unknown',
          },
        },
        'major-no-digest',
      ),
    ).toBe(false);
  });
});
