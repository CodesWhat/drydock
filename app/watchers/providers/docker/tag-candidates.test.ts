import { describe, expect, test, vi } from 'vitest';

import {
  filterBySegmentCount,
  getCurrentPrefix,
  getFirstDigitIndex,
  getTagCandidates,
} from './tag-candidates.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    image: {
      tag: {
        value: '1.0.0',
        semver: true,
      },
    },
    includeTags: undefined,
    excludeTags: undefined,
    transformTags: undefined,
    tagFamily: 'strict',
    ...overrides,
  } as any;
}

describe('docker tag candidates module', () => {
  test('returns strict-family no-update reason when only cross-family tags are higher', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3-ls132',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['1.2.2-ls132', '1.2.4'], log);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toContain(
      'Strict tag-family policy filtered out 1 higher semver tag(s)',
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dd.tag.family=loose'));
  });

  test('allows include-filter recovery for semver image outside include regex', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '2.0.0',
          semver: true,
        },
      },
      includeTags: '^1\\..*',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['1.9.0', '1.10.0'], log);

    expect(result.tags).toEqual(['1.10.0', '1.9.0']);
  });

  test('returns no candidates for non-semver image without includeTags', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'latest',
          semver: false,
        },
      },
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['1.2.0', '1.3.0'], log);

    expect(result.tags).toEqual([]);
  });

  test('keeps segment count and prefix/suffix family in filterBySegmentCount', () => {
    const filtered = filterBySegmentCount(
      ['1.2.4', '1.2.4-ls133', '1.2.4-r1', '1.2', 'v1.2.4-ls133'],
      createContainer({
        image: {
          tag: {
            value: '1.2.3-ls132',
            semver: true,
          },
        },
      }),
    );

    expect(filtered).toEqual(['1.2.4-ls133']);
  });

  test('exposes digit/prefix helpers', () => {
    expect(getFirstDigitIndex('release-v2026.3.0')).toBe(9);
    expect(getFirstDigitIndex('latest')).toBe(-1);
    expect(getCurrentPrefix('v2026.3.0')).toBe('v');
    expect(getCurrentPrefix('2026.3.0')).toBe('');
  });

  test('drops non-semver candidates during semver filtering', () => {
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(
      createContainer({ includeTags: '.*' }),
      ['not-a-semver', '1.0.1'],
      log,
    );

    expect(result.tags).toEqual(['1.0.1']);
  });

  test('returns original segment candidates when current tag has no numeric shape', () => {
    const inputTags = ['latest', 'stable', 'edge'];
    const filtered = filterBySegmentCount(
      inputTags,
      createContainer({
        image: {
          tag: {
            value: 'latest',
            semver: false,
          },
        },
      }),
    );

    expect(filtered).toEqual(inputTags);
  });
});
