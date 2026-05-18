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

  // Kills mutants on hasKnownTagSemver (line 52):
  // - updateKind === 'tag' && ... (LogicalOperator mutation to ||)
  // - Boolean(semverDiff) (ConditionalExpression true)
  // - semverDiff !== 'unknown' (ConditionalExpression true / StringLiteral "")

  test('isThresholdReached: digest updateKind with semver threshold falls through to return true', () => {
    // digest updateKind with non-'unknown' semverDiff should NOT match hasKnownTagSemver
    // because updateKind is not 'tag'. Result: falls through to return true.
    expect(
      isThresholdReached({ updateKind: { kind: 'digest', semverDiff: 'minor' } }, 'minor'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with undefined semverDiff falls through to return true', () => {
    // tag updateKind but semverDiff is undefined/falsy — Boolean(semverDiff) is false
    // so hasKnownTagSemver returns false, falls through to return true
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: undefined } }, 'minor'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with empty string semverDiff falls through to return true', () => {
    // semverDiff = '' is falsy, Boolean('') === false, so not a known semver
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: '' } }, 'minor')).toBe(true);
  });

  test('isThresholdReached: tag with semverDiff=unknown falls through to return true', () => {
    // semverDiff === 'unknown' means hasKnownTagSemver is false, falls through to return true
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'unknown' } }, 'minor'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with known semverDiff=minor and threshold=minor returns true', () => {
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'minor')).toBe(
      true,
    );
  });

  test('isThresholdReached: tag with known semverDiff=major and threshold=minor returns false', () => {
    // minor predicate: semverDiff !== 'major' -> false for 'major'
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'major' } }, 'minor')).toBe(
      false,
    );
  });

  test('isThresholdReached: tag with known semverDiff=major and threshold=major-only returns true', () => {
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'major' } }, 'major-only'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with known semverDiff=minor and threshold=major-only returns false', () => {
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'major-only'),
    ).toBe(false);
  });

  test('isThresholdReached: tag with known semverDiff=patch and threshold=patch returns true', () => {
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'patch' } }, 'patch')).toBe(
      true,
    );
  });

  test('isThresholdReached: tag with known semverDiff=minor and threshold=patch returns false', () => {
    // patch predicate: semverDiff !== 'major' && semverDiff !== 'minor' -> false for 'minor'
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'patch')).toBe(
      false,
    );
  });

  test('isThresholdReached: digest threshold returns true for digest update', () => {
    expect(
      isThresholdReached({ updateKind: { kind: 'digest', semverDiff: undefined } }, 'digest'),
    ).toBe(true);
  });

  test('isThresholdReached: digest threshold returns false for tag update', () => {
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'digest')).toBe(
      false,
    );
  });

  // Kills line 89 mutant: ConditionalExpression true
  test('isThresholdReached: non-digest, non-unknown updateKind with unknown threshold returns true', () => {
    // When updateKind='tag' but semverDiff='unknown', hasKnownTagSemver is false
    // so evaluateSemverThreshold is NOT called. Falls through to return true.
    // The line 89 mutant changes `if (hasKnownTagSemver(...))` to `if (true)` which
    // would call evaluateSemverThreshold even when semverDiff='unknown' — for 'minor-only'
    // this would return false instead of true.
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'unknown' } }, 'minor-only'),
    ).toBe(true);
  });

  test('isThresholdReached: tag update with no semverDiff and all threshold returns true', () => {
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: undefined } }, 'all')).toBe(
      true,
    );
  });
});
