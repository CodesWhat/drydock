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
  // - updateKind === 'tag' → true (ConditionalExpression)
  // - updateKind === 'tag' || ... (LogicalOperator mutation to ||)
  // - Boolean(semverDiff) → true (ConditionalExpression)
  // - semverDiff !== 'unknown' → true (ConditionalExpression / StringLiteral "")
  //
  // Key: we need inputs where hasKnownTagSemver returns false normally but the mutant
  // makes it return true, causing evaluateSemverThreshold to return a DIFFERENT value
  // than the fall-through 'return true'.

  test('isThresholdReached: digest with major semverDiff and minor threshold returns true (kills updateKind===tag mutation)', () => {
    // Normal: hasKnownTagSemver('digest', 'major') → 'digest'==='tag' is false → false → return true
    // Mutant (===tag → true): true && Boolean('major') && 'major'!=='unknown' → true
    //   → evaluateSemverThreshold('minor', 'major') → 'major'!=='major' is false → false ≠ expected true
    expect(
      isThresholdReached({ updateKind: { kind: 'digest', semverDiff: 'major' } }, 'minor'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with undefined semverDiff and minor threshold returns true (kills Boolean(semverDiff) mutation)', () => {
    // Normal: hasKnownTagSemver('tag', undefined) → Boolean(undefined) is false → false → return true
    // Mutant (Boolean→true): true && true && undefined!=='unknown' → true (undefined!=='unknown' is true)
    //   → evaluateSemverThreshold('minor', undefined) → undefined!=='major' is true → returns true (same!)
    // Use 'major-only' threshold instead: evaluateSemverThreshold('major-only', undefined)
    //   → undefined==='major' is false → returns false ≠ expected true
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: undefined } }, 'major-only'),
    ).toBe(true);
  });

  test('isThresholdReached: tag with empty semverDiff and major-only threshold returns true (kills Boolean mutation)', () => {
    // Normal: Boolean('') === false → hasKnownTagSemver returns false → return true
    // Mutant (Boolean→true): true && true && ''!=='unknown' → true
    //   → evaluateSemverThreshold('major-only', '') → ''==='major' is false → returns false ≠ true
    expect(isThresholdReached({ updateKind: { kind: 'tag', semverDiff: '' } }, 'major-only')).toBe(
      true,
    );
  });

  test('isThresholdReached: tag with semverDiff=unknown and major-only threshold returns true (kills !==unknown mutation)', () => {
    // Normal: semverDiff!=='unknown' is false → hasKnownTagSemver returns false → return true
    // Mutant (!==unknown → true): true && Boolean('unknown') && true → true
    //   → evaluateSemverThreshold('major-only', 'unknown') → 'unknown'==='major' is false → false ≠ true
    expect(
      isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'unknown' } }, 'major-only'),
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
