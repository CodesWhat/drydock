import { describe, expect, test } from 'vitest';

import { computeUpdateCandidates } from './update-candidates.js';

describe('computeUpdateCandidates', () => {
  test('picks the highest tag per update type', () => {
    const tags = ['3.0.0', '2.5.1', '2.5.0', '2.4.9', '2.3.7', '2.3.6'];
    expect(computeUpdateCandidates(tags, '2.3.4', undefined)).toEqual({
      patch: { tag: '2.3.7', semverDiff: 'patch' },
      minor: { tag: '2.5.1', semverDiff: 'minor' },
      major: { tag: '3.0.0', semverDiff: 'major' },
    });
  });

  test('omits types with no candidate', () => {
    expect(computeUpdateCandidates(['2.4.0', '2.3.5'], '2.3.4', undefined)).toEqual({
      patch: { tag: '2.3.5', semverDiff: 'patch' },
      minor: { tag: '2.4.0', semverDiff: 'minor' },
    });
  });

  test('returns nothing when only one type has a candidate', () => {
    expect(computeUpdateCandidates(['2.3.5', '2.3.6'], '2.3.4', undefined)).toBeUndefined();
  });

  test('attaches a known digest only to the matching tag', () => {
    const result = computeUpdateCandidates(['3.0.0', '2.3.5'], '2.3.4', undefined, {
      tag: '3.0.0',
      digest: 'sha256:abc',
    });
    expect(result?.major).toEqual({ tag: '3.0.0', digest: 'sha256:abc', semverDiff: 'major' });
    expect(result?.patch).toEqual({ tag: '2.3.5', semverDiff: 'patch' });
  });

  test('classifies against the transformed running tag', () => {
    const transform = '^release-(\\d+\\.\\d+\\.\\d+) => $1';
    const result = computeUpdateCandidates(
      ['release-2.4.0', 'release-2.3.5'],
      'release-2.3.4',
      transform,
    );
    expect(result).toEqual({
      minor: { tag: 'release-2.4.0', semverDiff: 'minor' },
      patch: { tag: 'release-2.3.5', semverDiff: 'patch' },
    });
  });

  test('compares segments numerically with leading zeros', () => {
    const result = computeUpdateCandidates(['2.10.0', '2.9.1'], '2.09.0', undefined);
    expect(result).toEqual({
      minor: { tag: '2.10.0', semverDiff: 'minor' },
      patch: { tag: '2.9.1', semverDiff: 'patch' },
    });
  });

  test('rejects shorter and missing candidate segments below the running version', () => {
    expect(computeUpdateCandidates(['2.9.1'], '2.10.0', undefined)).toBeUndefined();
    expect(computeUpdateCandidates(['2'], '2.1.0', undefined)).toBeUndefined();
  });

  test('treats a missing minor segment as zero', () => {
    expect(computeUpdateCandidates(['3', '2.1'], '2', undefined)).toEqual({
      major: { tag: '3', semverDiff: 'major' },
      minor: { tag: '2.1', semverDiff: 'minor' },
    });
  });

  test('skips tags without a numeric version and lower versions', () => {
    expect(
      computeUpdateCandidates(['latest', '1.9.9', '2.2.9'], '2.3.4', undefined),
    ).toBeUndefined();
  });

  test('skips candidates with a lower minor in the same major', () => {
    expect(computeUpdateCandidates(['2.2.9'], '2.3.4', undefined)).toBeUndefined();
  });

  test('returns undefined when the running tag has no version', () => {
    expect(computeUpdateCandidates(['1.0.0'], 'latest', undefined)).toBeUndefined();
  });
});
