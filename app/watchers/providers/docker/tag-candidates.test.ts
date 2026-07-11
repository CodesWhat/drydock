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
  isPrereleaseSuffix,
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

  test('rejects floating semver aliases (e.g. "3.3" alongside "3.3.0") as not-greater (#342)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '3.3.0',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // Mirrors afadil/wealthfolio's published tags: floating "3.3" alias for the
    // same digest as "3.3.0", plus older releases. The "3.3" alias must not be
    // counted as a higher-semver candidate dropped by the family filter.
    const result = getTagCandidates(
      container,
      ['3.3', '3.3.0', '3.2', '3.2.1', '3.2.0', '3.1.2'],
      log,
    );

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('higher semver tag(s) outside the inferred family'),
    );
  });

  test('rejects two-digit prefixed alias ("v3.3") of three-digit current ("v3.3.0") (#342)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'v3.3.0',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['v3.3', 'v3.3.0', 'v3.2.1'], log);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toBeUndefined();
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

  test('keeps strict floating version aliases on the current tag', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '16-alpine',
          semver: true,
          tagPrecision: 'floating',
        },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['16-alpine', '16.1-alpine', '17-alpine'], log);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toContain('Floating tag alias "16-alpine"');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Floating tag alias'));
  });

  test('suppresses noUpdateReason for floating strict-mode when digest watch is enabled', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'latest',
          semver: true,
          tagPrecision: 'floating',
        },
        digest: { watch: true },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['latest', '1.0.0', '2.0.0'], log);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toBeUndefined();
  });

  test('floating alias with digest.watch=false → noUpdateReason explains digest watching is disabled, no false digest-comparison claim (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '16-alpine',
          semver: true,
          tagPrecision: 'floating',
        },
        digest: { watch: false },
      },
      tagFamily: 'strict',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['16-alpine', '16.1-alpine', '17-alpine'], log);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toContain('Floating tag alias');
    expect(result.noUpdateReason).toContain('digest watching is disabled');
    expect(result.noUpdateReason).not.toContain('is compared by digest in strict tag-family mode');
  });

  test('handles floating strict-mode without a debug-capable log container', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'stable',
          semver: true,
          tagPrecision: 'floating',
        },
      },
      tagFamily: 'strict',
    });

    const result = getTagCandidates(container, ['stable', '1.0.0'], undefined as any);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toContain('Floating tag alias "stable"');
  });

  test('allows floating version aliases to cross tags when tag family is loose', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '16-alpine',
          semver: true,
          tagPrecision: 'floating',
        },
      },
      tagFamily: 'loose',
    });
    const log = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const result = getTagCandidates(container, ['16-alpine', '16.1-alpine', '17-alpine'], log);

    expect(result.tags).toEqual(['17-alpine']);
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

  test('sort output is identical whether transform is applied once up-front or per-compare', () => {
    // Regression guard for the pre-compute-before-sort optimisation.
    // The sorted order must match what a naive in-comparator transform would produce.
    const container = createContainer({
      image: {
        tag: {
          value: 'v1.0.0',
          semver: true,
        },
      },
      transformTags: '^v(\\d+\\.\\d+\\.\\d+)$ => $1',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const inputTags = ['v1.0.1', 'v1.2.0', 'v1.0.5', 'v1.1.3', 'v2.0.0', 'v1.0.2'];
    const result = getTagCandidates(container, inputTags, log);

    // Expect descending semver order after transform strips the 'v' prefix
    expect(result.tags).toEqual(['v2.0.0', 'v1.2.0', 'v1.1.3', 'v1.0.5', 'v1.0.2', 'v1.0.1']);
  });

  describe('specific-tag pin gate', () => {
    test('specific v1.13.3, no labels → digest-only, no semver climb', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(
        container,
        ['v1.13.3', 'v1.13.4', 'v1.14.0', 'v1.46.1', 'v2.0.0'],
        log,
      );

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Pinned tag');
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Pinned tag'));
    });

    test('specific v1.13.3 + dd.tag.include → climbs within filter, not beyond', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        includeTags: '^v1\\.13\\.',
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.13.4', 'v1.14.0', 'v1.46.1'], log);

      expect(result.tags).toContain('v1.13.4');
      expect(result.tags).not.toContain('v1.14.0');
      expect(result.tags).not.toContain('v1.46.1');
    });

    test('specific v1.13.3 + dd.tag.family=loose → semver climb allowed', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'loose',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.13.4', 'v1.14.0', 'v1.46.1'], log);

      expect(result.tags).toContain('v1.46.1');
    });

    test('floating latest with no labels → unchanged (floating gate fires, not specific gate)', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'latest',
            semver: true,
            tagPrecision: 'floating',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['latest', '1.0.0', '2.0.0'], log);

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Floating tag alias');
    });

    test('specific CalVer 2026.3.0, no labels → pinned, no semver climb', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '2026.3.0',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['2026.3.0', '2026.4.0', '2027.1.0'], log);

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Pinned tag');
    });

    test('specific pin with digest.watch=true → noUpdateReason is undefined', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
          digest: { watch: true },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.13.4', 'v1.46.1'], log);

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toBeUndefined();
    });

    test('specific pin with digest.watch=false → noUpdateReason explains digest watching is disabled, no false digest-comparison claim (#498)', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
          digest: { watch: false },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.13.4', 'v1.46.1'], log);

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Pinned tag');
      expect(result.noUpdateReason).toContain('digest watching is disabled');
      expect(result.noUpdateReason).not.toContain('is compared by digest only');
    });

    test('specific suffixed 3-segment 1.13.3-bookworm, no labels → digest-only, no semver climb', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.13.3-bookworm',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(
        container,
        ['1.13.3-bookworm', '1.13.4-bookworm', '1.14.0-bookworm', '1.46.1-bookworm'],
        log,
      );

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Pinned tag');
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Pinned tag'));
    });

    test('specific 4-segment 1.2.3.4, no labels → digest-only, no semver climb', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.2.3.4',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['1.2.3.4', '1.2.3.5', '1.3.0.0'], log);

      expect(result.tags).toEqual([]);
      expect(result.noUpdateReason).toContain('Pinned tag');
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Pinned tag'));
    });
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

  // Coverage for branch: excludeTags compile fails (safeRegExp returns null) → no filtering
  test('skips exclude filtering when excludeTags regex fails to compile', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementationOnce(() => {
      throw new Error('bad regex');
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(
      createContainer({ excludeTags: '[invalid' }),
      ['1.0.1', '1.0.2'],
      log,
    );

    // With failed excludeTags compile, all tags pass through unfiltered (sorted descending)
    expect(result.tags).toEqual(['1.0.2', '1.0.1']);
    compileSpy.mockRestore();
  });

  // Coverage for branch: specific-tag pin gate without debug function
  test('specific pin gate does not throw when logContainer has no debug function', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'v1.0.0',
          semver: true,
          tagPrecision: 'specific',
        },
      },
      tagFamily: 'strict',
    });
    const log = { warn: vi.fn() };

    const result = getTagCandidates(container, ['v1.0.1', 'v1.1.0'], log as any);

    expect(result.tags).toEqual([]);
    expect(result.noUpdateReason).toContain('Pinned tag');
  });

  // Coverage for pre-existing branch: regex pattern length exceeds 1024 chars
  test('warns and returns null when includeTags regex pattern exceeds max length', () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    const overLongPattern = 'a'.repeat(1025);

    const result = getTagCandidates(
      createContainer({ includeTags: overLongPattern }),
      ['1.0.1'],
      log,
    );

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Regex pattern exceeds maximum length'),
    );
    // When includeTags compile fails, baseTags is unfiltered — falls through non-semver path
    expect(result).toBeDefined();
  });

  // Coverage for pre-existing branch: no prefix (tag starts with a digit, no prefix string)
  test('warns with no-prefix message when current tag has no alphabetic prefix', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
        },
      },
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // Pass tags that don't start with digits and don't start with '1'
    getTagCandidates(container, ['v1.2.4', 'v1.3.0'], log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No tags found starting with a number'),
    );
  });

  // Coverage for pre-existing branch: tagFamily is undefined/falsy → strict
  test('returns strict when tagFamily is undefined', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
        },
      },
      tagFamily: undefined,
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // Should not warn about invalid tagFamily when it's undefined
    const result = getTagCandidates(container, ['1.2.4'], log);
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Invalid tag family'));
    expect(result.tags).toContain('1.2.4');
  });

  // Coverage for pre-existing branch: isSemverFamilyMatch with null referenceShape
  test('accepts any candidate when current tag has no parseable numeric shape', () => {
    // Tag 'latest' has no numeric segments → referenceShape is null → isSemverFamilyMatch returns true
    const container = createContainer({
      image: {
        tag: {
          value: 'latest',
          semver: true,
          // No tagPrecision set — not 'floating', so floating gate doesn't fire
        },
      },
      includeTags: '^\\d+',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['1.0.0', '2.0.0'], log);

    // With no referenceShape, family matching is skipped — any semver candidate passes
    expect(result.tags.length).toBeGreaterThan(0);
  });

  // Coverage for pre-existing branch: invalid tagFamily warns and falls back to strict
  test('warns and falls back to strict when tagFamily has an invalid value', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
        },
      },
      tagFamily: 'invalid-value',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // Should still run and fall back to strict behavior
    const result = getTagCandidates(container, ['1.2.4', '1.3.0'], log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid tag family policy "invalid-value"'),
    );
    expect(result.tags).toContain('1.2.4');
  });

  // Coverage for pre-existing branch: logSemverCandidateFilterStats returns early when no debug function
  test('does not throw when logContainer has no debug function during stats logging', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
        },
      },
    });
    // Logger without debug function
    const log = { warn: vi.fn() };

    expect(() => getTagCandidates(container, ['1.2.4'], log as any)).not.toThrow();
  });

  // Coverage for pre-existing branch: non-semver tag + includeTags returns semver tags from filtered set
  test('returns semver tags for non-semver tag with includeTags when filtered tags include semver', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // Include filter passes v-prefixed tags; filterSemverOnly keeps valid semver only
    const result = getTagCandidates(container, ['v1.0.0', 'v1.1.0', 'not-semver'], log);

    expect(result.tags).toContain('v1.1.0');
    expect(result.tags).toContain('v1.0.0');
  });

  // Coverage for branch: non-semver tag + includeTags when none of the filtered tags parse as semver
  test('returns empty tags for non-semver tag with includeTags when no filtered tags are semver', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v\\d+\\.\\d+\\.\\d+$',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // All tags pass include filter but none parse as semver
    const result = getTagCandidates(container, ['nightly', 'unstable'], log);

    expect(result.tags).toEqual([]);
  });

  // Coverage for pre-existing branch: warn when filteredTags is empty after include/exclude
  test('warns when all tags are filtered out before semver candidate pass', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.0.0',
          semver: true,
        },
      },
      includeTags: '^will-never-match-anything$',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    getTagCandidates(container, ['1.0.1', '1.0.2'], log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No tags found after filtering'));
  });

  // Coverage for pre-existing branch: warn when no tags pass prefix filter
  test('warns when no candidate tags match the current tag prefix', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'v1.0.0',
          semver: true,
        },
      },
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // All candidates start with 'r' not 'v'
    getTagCandidates(container, ['r1.0.1', 'r1.0.2'], log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("No tags found with existing prefix: 'v'"),
    );
  });

  // Coverage for pre-existing branch: warn when semver candidates exist but none in same family
  test('warns when semver tags exist but none are in the same inferred family', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3-arm64',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    // Candidates are valid semver but with different suffix family
    getTagCandidates(container, ['1.2.4-amd64', '1.3.0-amd64'], log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No tags found in the same inferred family'),
    );
  });

  // #498: loose mode previously bypassed the suffix/variant guard entirely
  // (isSemverFamilyMatch returned true before isStrictFamilyMatch/isSuffixCompatible
  // ever ran). Fixed so loose still requires a compatible suffix; it only relaxes
  // prefix equality and leading-zero rules.
  test('loose mode still enforces the suffix/variant guard — a bare tag is not a candidate for a suffixed reference (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3-ls132',
          semver: true,
        },
      },
      tagFamily: 'loose',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['1.2.3-ls132', '1.2.4', '1.2.4-ls133'], log);

    // '1.2.4' (bare) is rejected — only the same-variant '1.2.4-ls133' remains.
    expect(result.tags).toEqual(['1.2.4-ls133']);
  });

  // #498: sortSemverDescending() previously ranked by raw semver precedence, where
  // semver treats a suffix as a prerelease — so a bare "3.0.2" would outrank
  // "3.0.2-alpine" even for an "-alpine" reference. Fixed to prefer the candidate
  // whose suffix template exactly matches the reference's when numeric segments tie.
  test('actionable path sort prefers the exact-suffix-match candidate at the same numeric version (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3-alpine',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(
      container,
      ['1.2.3-alpine', '1.2.5-alpine3.21', '1.2.5-alpine'],
      log,
    );

    expect(result.tags[0]).toBe('1.2.5-alpine');
  });

  // #498: when the current tag itself has no numeric shape (e.g. a rolling
  // alias like "nightly"), sortSemverDescending has no reference suffix
  // template to tie-break against, so numeric-segment ties fall through to
  // plain semver ordering unchanged.
  test('falls back to plain semver ordering for numeric-segment ties when the current tag has no numeric shape (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['v1.0.0-rc1', 'v1.0.0-rc2'], log);

    expect(result.tags[0]).toBe('v1.0.0-rc2');
  });

  // #498: mirrors the exact-suffix-match test above with the exact-match
  // candidate appearing first in tag order instead of second. Array.sort's
  // comparator argument order depends on element position, so this exercises
  // the branch of the tie-break that the other ordering does not reach.
  test('actionable path sort prefers the exact-suffix-match candidate regardless of input tag order (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: '1.2.3-alpine',
          semver: true,
        },
      },
      tagFamily: 'strict',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(
      container,
      ['1.2.3-alpine', '1.2.5-alpine', '1.2.5-alpine3.21'],
      log,
    );

    expect(result.tags[0]).toBe('1.2.5-alpine');
  });

  // #498: a fallback-path (non-semver current tag + includeTags) candidate
  // pair with different numeric-segment counts exercises the missing-segment
  // "?? '0'" padding in compareNumericSegmentsDescending — the family filter
  // that normally guarantees equal segment counts does not apply here.
  test('pads missing numeric segments as 0 when comparing candidates of different precision (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['v1.2.3', 'v1.2'], log);

    expect(result.tags[0]).toBe('v1.2.3');
  });

  // #498: mirrors the padding test above with the shorter-precision tag
  // first in input order instead of second, exercising the '?? 0' fallback
  // for the other comparator argument (see the input-order note above).
  test('pads missing numeric segments as 0 regardless of which candidate is shorter (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['v1.2', 'v1.2.3'], log);

    expect(result.tags[0]).toBe('v1.2.3');
  });

  // #498: a transform formula can mangle a tag into a string containing an
  // embedded newline. getNumericTagShapeFromTransformedTag defensively
  // refuses such strings (returns null) while the app's semver parser still
  // recovers a version via its coerce() fallback, so filterSemverOnly still
  // admits the tag. sortSemverDescending must fall back to plain semver
  // comparison rather than crash when a candidate's shape is null.
  test('falls back to plain semver comparison when a transform mangles a tag beyond shape parsing (#498)', () => {
    const container = createContainer({
      image: {
        tag: {
          value: 'nightly',
          semver: false,
        },
      },
      includeTags: '^v',
      transformTags: '(.+) => $1\nx',
    });
    const log = { warn: vi.fn(), debug: vi.fn() };

    const result = getTagCandidates(container, ['v1.2.3', 'v5.0.0'], log);

    expect(result.tags[0]).toBe('v5.0.0');
  });

  describe('pin-gate informational insight (#498)', () => {
    test('computes the informational insight tag for a pinned specific-precision tag', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.13.4', 'v1.14.0', 'v1.46.1'], log);

      expect(result.tags).toEqual([]);
      expect(result.insight).toEqual({ tag: 'v1.46.1', kind: 'minor' });
    });

    test('allows a cross-major jump — that is the whole point of the informational channel', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['1.13.3', '2.0.0'], log);

      expect(result.insight).toEqual({ tag: '2.0.0', kind: 'major' });
    });

    test('never crosses the suffix/variant boundary — bare candidate is rejected for a suffixed pin', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '2.7.5-openvino',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(
        container,
        ['2.7.5-openvino', '2.7.6-openvino', '3.0.2-openvino', '3.0.2'],
        log,
      );

      expect(result.insight).toEqual({ tag: '3.0.2-openvino', kind: 'major' });
    });

    test('prefers the exact-suffix-match candidate over a merely-compatible one at the same version', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.2.3-alpine',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(
        container,
        ['1.2.3-alpine', '1.2.5-alpine3.21', '1.2.5-alpine'],
        log,
      );

      expect(result.insight).toEqual({ tag: '1.2.5-alpine', kind: 'patch' });
    });

    test('omits insight when no strictly-newer same-family candidate exists', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['1.13.3', '1.13.2'], log);

      expect(result.insight).toBeUndefined();
    });

    test('is never computed for the floating pin gate', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '16-alpine',
            semver: true,
            tagPrecision: 'floating',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['16-alpine', '17-alpine'], log);

      expect(result.insight).toBeUndefined();
    });

    test('is skipped entirely when the computeInsight flag is false (opt-out)', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.13.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.13.3', 'v1.46.1'], log, false);

      expect(result.tags).toEqual([]);
      expect(result.insight).toBeUndefined();
    });

    // #498: isSuffixCompatible() previously rejected every bare candidate
    // whenever the reference had a suffix, so a prerelease pin (e.g.
    // "1.5.2-rc.1") could never see its own GA release ("1.5.2") — and worse,
    // with both an older prerelease and a newer prerelease of the *next*
    // release in the registry, it would surface the wrong one while hiding
    // the GA it should have shown. Fixed narrowly: a bare candidate is now
    // accepted only when the reference suffix is a conventional prerelease
    // identifier (isPrereleaseSuffix) — variant suffixes are unaffected.
    describe('prerelease-pinned tags see their own GA release (#498)', () => {
      test('a prerelease pin sees its own bare GA release as insight', () => {
        const container = createContainer({
          image: {
            tag: {
              value: '1.5.2-rc.1',
              semver: true,
              tagPrecision: 'specific',
            },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['1.5.2-rc.1', '1.5.2'], log);

        // diffSemver('1.5.2-rc.1', '1.5.2') reports 'patch' (semver treats
        // resolving a prerelease to its release as a patch-level change here
        // since the core version doesn't change) — toPinInfoKind maps that
        // straight through.
        expect(result.insight).toEqual({ tag: '1.5.2', kind: 'patch' });
      });

      test('a same-template prerelease progression still wins over the bare GA of an older release', () => {
        const container = createContainer({
          image: {
            tag: {
              value: '1.5.2-rc.1',
              semver: true,
              tagPrecision: 'specific',
            },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['1.5.2-rc.1', '1.5.2-rc.2'], log);

        expect(result.insight).toEqual({ tag: '1.5.2-rc.2', kind: 'patch' });
      });

      test('a variant-suffixed pin still never gets a bare candidate as insight — the widening is prerelease-only', () => {
        const container = createContainer({
          image: {
            tag: {
              value: 'v2.7.5-openvino',
              semver: true,
              tagPrecision: 'specific',
            },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['v2.7.5-openvino', 'v3.0.2'], log);

        expect(result.insight).toBeUndefined();
      });

      test('a bare-tag pin still never gets a suffixed candidate as insight', () => {
        const container = createContainer({
          image: {
            tag: {
              value: '1.5.2',
              semver: true,
              tagPrecision: 'specific',
            },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['1.5.2', '1.6.0-rc.1'], log);

        expect(result.insight).toBeUndefined();
      });
    });

    // #501: the #498 prerelease->GA widening in isSuffixCompatible() must be
    // scoped to the informational insight path only. A container pinned to a
    // prerelease tag with dd.tag.family=loose (or an includeTags filter) can
    // reach the same isSuffixCompatible() check via the *actionable* path
    // (isSemverFamilyMatch -> shouldIncludeSemverCandidate), which must never
    // treat a bare GA release as an actionable update candidate — only the
    // insight badge is allowed to surface it.
    describe('prerelease->GA widening does not leak into the actionable path (#501)', () => {
      test('actionable candidates exclude the bare GA release but still include a newer same-template prerelease', () => {
        const container = createContainer({
          image: {
            tag: {
              value: '1.5.2-rc.1',
              semver: true,
              tagPrecision: 'specific',
            },
          },
          tagFamily: 'loose',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['1.5.2', '1.5.3-rc.1'], log);

        expect(result.tags).toContain('1.5.3-rc.1');
        expect(result.tags).not.toContain('1.5.2');
      });
    });

    // #498 (nit): when the current tag's transformed value has no derivable
    // numeric shape (here via a transform that mangles it beyond shape
    // parsing, same trick as the actionable-path coverage above), the
    // same-core guard has nothing to compare against and must not filter —
    // candidates pass through unchanged.
    test('does not filter insight candidates when the current tag has no numeric shape', () => {
      const container = createContainer({
        image: {
          tag: {
            value: 'v1.2.3',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
        transformTags: '(.+) => $1\nx',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['v1.2.3', 'v1.3.0'], log);

      expect(result.insight).toEqual({ tag: 'v1.3.0', kind: 'minor' });
    });

    // #498 (nit): a candidate whose numeric core matches the current tag's
    // and whose suffix merely grows more *precise* (e.g. "-alpine" ->
    // "-alpine3.21") is the same version described more specifically, not a
    // newer one. Without this guard, semver's lexical prerelease-string
    // comparison ("alpine3.21" > "alpine") fabricated a "newer patch".
    test('same-core suffix-precision growth is not reported as an insight', () => {
      const container = createContainer({
        image: {
          tag: {
            value: '1.2.3-alpine',
            semver: true,
            tagPrecision: 'specific',
          },
        },
        tagFamily: 'strict',
      });
      const log = { warn: vi.fn(), debug: vi.fn() };

      const result = getTagCandidates(container, ['1.2.3-alpine', '1.2.3-alpine3.21'], log);

      expect(result.insight).toBeUndefined();
    });

    // #498: the pin gate's digest-disabled noUpdateReason must not contradict
    // a rendered updateInsight badge. When an insight will still be shown,
    // the wording is narrowed to "no actionable update detection" rather than
    // claiming no update detection of any kind is running.
    describe('digest-disabled noUpdateReason wording stays accurate alongside insight (#498)', () => {
      test('keeps the original stronger wording when the insight is also disabled (opt-out)', () => {
        const container = createContainer({
          image: {
            tag: { value: 'v1.13.3', semver: true, tagPrecision: 'specific' },
            digest: { watch: false },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['v1.13.3', 'v1.46.1'], log, false);

        expect(result.insight).toBeUndefined();
        expect(result.noUpdateReason).toContain('digest watching is disabled');
        expect(result.noUpdateReason).toContain('no update detection is running');
        expect(result.noUpdateReason).not.toContain('actionable');
      });

      test('keeps the original stronger wording when no insight candidate exists', () => {
        const container = createContainer({
          image: {
            tag: { value: 'v1.13.3', semver: true, tagPrecision: 'specific' },
            digest: { watch: false },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['v1.13.3', 'v1.13.2'], log);

        expect(result.insight).toBeUndefined();
        expect(result.noUpdateReason).toContain('no update detection is running');
        expect(result.noUpdateReason).not.toContain('actionable');
      });

      test('narrows the wording to "no actionable update detection" when an insight is still shown', () => {
        const container = createContainer({
          image: {
            tag: { value: 'v1.13.3', semver: true, tagPrecision: 'specific' },
            digest: { watch: false },
          },
          tagFamily: 'strict',
        });
        const log = { warn: vi.fn(), debug: vi.fn() };

        const result = getTagCandidates(container, ['v1.13.3', 'v1.46.1'], log);

        expect(result.insight).toEqual({ tag: 'v1.46.1', kind: 'minor' });
        expect(result.noUpdateReason).toContain('digest watching is disabled');
        expect(result.noUpdateReason).toContain('no actionable update detection is running');
        expect(result.noUpdateReason).toContain('still shown for information');
      });
    });
  });
});

describe('isPrereleaseSuffix (#498)', () => {
  test.each([
    ['-rc.1', true],
    ['-rc1', true],
    ['rc', true],
    ['-beta2', true],
    ['-alpha', true],
    ['-PRE', true],
    ['-RC.3', true],
    ['-preview.4', true],
    ['-dev', true],
    ['-next.1', true],
    ['-canary', true],
    ['-snapshot.20260101', true],
    ['-openvino', false],
    ['-cuda', false],
    ['-alpine3.19', false],
    ['-ls132', false],
    ['-bookworm', false],
    ['', false],
  ])('isPrereleaseSuffix(%s) → %s', (suffix, expected) => {
    expect(isPrereleaseSuffix(suffix)).toBe(expected);
  });
});
