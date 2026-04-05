import { performance } from 'node:perf_hooks';
import { RE2JS } from 're2js';
import { describe, expect, test, vi } from 'vitest';

import { getNumericTagShape as getSharedNumericTagShape } from '../../../tag/precision.js';
import {
  filterBySegmentCount,
  getCurrentPrefix,
  getFirstDigitIndex,
  getNumericTagShape,
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

  test('allows CalVer tags with zero-padded months through strict family filter (#202)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '2025.11.1',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(
      container,
      ['2025.11.1', '2026.02.0', '2026.01.0', '2025.09.3'],
      log,
    );

    expect(result.tags).toContain('2026.02.0');
    expect(result.tags).toContain('2026.01.0');
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('allows CalVer upgrade when both reference and candidate have zero-padded segments', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '2025.01.3',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['2025.01.3', '2025.02.0'], log);

    expect(result.tags).toContain('2025.02.0');
  });

  test('allows CalVer zero-padded month family matches in filterBySegmentCount', () => {
    const filtered = filterBySegmentCount(
      ['2026.02.0', '2026.2.0', '2026.02', 'v2026.02.0'],
      createContainer({
        image: {
          tag: {
            value: '2025.11.1',
            semver: true,
          },
        },
      }),
    );

    expect(filtered).toEqual(['2026.02.0', '2026.2.0']);
  });

  test('still rejects zero-padded tags for non-CalVer semver in strict mode', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '5.1.4',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // '20.04.1' has a leading zero in '04' but reference major is 5 (not CalVer).
    // Should be rejected as a cross-family jump.
    const result = getTagCandidates(container, ['5.1.4', '20.04.1', '5.1.5'], log);

    expect(result.tags).not.toContain('20.04.1');
    expect(result.tags).toContain('5.1.5');
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

  test('does not enable include-filter recovery when current semver tag matches include regex', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.5.0',
          semver: true,
        },
      },
      includeTags: '^1\\..*',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['1.4.0', '1.3.0'], log);

    expect(result.tags).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
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
    expect(getFirstDigitIndex('v0.0.1')).toBe(1);
    expect(getFirstDigitIndex('v9.0.1')).toBe(1);
    expect(getCurrentPrefix('v2026.3.0')).toBe('v');
    expect(getCurrentPrefix('2026.3.0')).toBe('');
  });

  test('drops sha-prefixed tags by default when includeTags is not set', () => {
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(createContainer(), ['sha999', '1.0.1', '1.0.2'], log);

    expect(result.tags).toEqual(['1.0.2', '1.0.1']);
  });

  test('applies excludeTags regex after include filtering', () => {
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(
      createContainer({
        includeTags: '^1\\..*',
        excludeTags: 'beta',
      }),
      ['1.0.1', '1.0.2-beta', '1.0.3'],
      log,
    );

    expect(result.tags).toEqual(['1.0.3', '1.0.1']);
  });

  test('drops .sig tags before semver candidate filtering', () => {
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(
      createContainer({
        includeTags: '^1\\..*',
        transformTags: '^(.*)\\.sig$ => $1',
      }),
      ['1.0.1.sig', '1.0.2'],
      log,
    );

    expect(result.tags).toEqual(['1.0.2']);
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

  test('reports error message from non-Error object with string message property', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw { message: 'custom compile failure' };
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('custom compile failure'));
    compileSpy.mockRestore();
  });

  test('falls back to String(error) for thrown non-Error primitive', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw 42;
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('42'));
    compileSpy.mockRestore();
  });

  test('falls back to String(error) for thrown null', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw null;
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith('Invalid regex pattern "anything": null');
    compileSpy.mockRestore();
  });

  test('uses the native Error message text without stringifying the full Error object', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw new Error('native compile failure');
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith(
      'Invalid regex pattern "anything": native compile failure',
    );
    compileSpy.mockRestore();
  });

  test('stringifies object errors when the message field is not a string', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw { message: { reason: 'custom compile failure' } };
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[object Object]'));
    compileSpy.mockRestore();
  });

  test('stringifies object errors when the message field is missing', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw { reason: 'custom compile failure' };
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(createContainer({ includeTags: 'anything' }), ['1.0.1'], log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[object Object]'));
    compileSpy.mockRestore();
  });

  test('extracts numeric tag shape with multi-digit segments and suffixes', () => {
    expect(getNumericTagShape('2025.11.1-alpine3.21', undefined)).toEqual({
      prefix: '',
      numericSegments: ['2025', '11', '1'],
      suffix: '-alpine3.21',
    });
  });

  test('reuses the shared numeric tag shape parser from tag/precision', () => {
    expect(getNumericTagShape).toBe(getSharedNumericTagShape);
  });

  test('rejects numeric tag shape parsing when the transformed tag contains newlines', () => {
    expect(getNumericTagShape('\n1.2.3', undefined)).toBeNull();
    expect(getNumericTagShape('1.2.3\nbeta', undefined)).toBeNull();
  });

  test('processes large tag lists within lightweight runtime budget', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.15.2-alpine3.21',
          semver: true,
        },
      },
      includeTags: '^1\\..*',
      excludeTags: '.*-rc.*',
      tagFamily: 'strict',
    });

    const tags = Array.from({ length: 1_000 }, (_, index) => {
      if (index % 41 === 0) return `1.${index}.0-rc1`;
      if (index % 13 === 0) return `2.${index % 30}.0`;
      return `1.${index % 40}.${index % 15}-alpine3.${index % 30}`;
    });

    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const runs = 5;
    let totalMs = 0;
    let lastResult = getTagCandidates(container, tags, log);
    for (let run = 0; run < runs; run += 1) {
      const started = performance.now();
      lastResult = getTagCandidates(container, tags, log);
      totalMs += performance.now() - started;
    }

    expect(lastResult.tags.length).toBeGreaterThan(0);
    const avgMs = totalMs / runs;
    expect(avgMs).toBeLessThan(200);
  });
});
