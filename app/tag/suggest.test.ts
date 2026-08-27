import { RE2JS } from 're2js';
import * as semver from './index.js';
import { suggest } from './suggest.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    includeTags: undefined,
    excludeTags: undefined,
    image: {
      tag: {
        value: 'latest',
      },
    },
    ...overrides,
  };
}

describe('tag/suggest', () => {
  test('should return null when current tag is not latest or untagged', () => {
    const container = createContainer({ image: { tag: { value: '1.2.3' } } });

    expect(suggest(container as any, ['1.0.0', '2.0.0'])).toBeNull();
  });

  test('should suggest highest stable semver for latest tag', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, [
      'latest',
      'nightly',
      '1.2.0-rc.1',
      '2.0.0-beta',
      '1.1.0',
      '1.2.3',
      '1.2.3+canary.1',
    ]);

    expect(suggestedTag).toBe('1.2.3');
  });

  test('should treat empty current tag as untagged and suggest stable semver', () => {
    const container = createContainer({ image: { tag: { value: '' } } });

    expect(suggest(container as any, ['0.9.0', '1.0.0', '1.0.1-alpha'])).toBe('1.0.0');
  });

  test('should treat missing current tag value as untagged', () => {
    const container = createContainer({ image: { tag: { value: undefined } } });

    expect(suggest(container as any, ['1.0.0', '2.0.0'])).toBe('2.0.0');
  });

  test('should apply include and exclude regex filters before suggesting', () => {
    const container = createContainer({
      includeTags: String.raw`^v?1\.`,
      excludeTags: String.raw`1\.1\.`,
      image: { tag: { value: 'latest' } },
    });

    const suggestedTag = suggest(container as any, ['v1.0.0', 'v1.1.0', 'v1.2.0', '2.0.0']);

    expect(suggestedTag).toBe('v1.2.0');
  });

  test('should return null when no stable semver tags are available', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, [
      'latest',
      'nightly',
      '1.0.0-rc.1',
      '2.0.0-beta',
      'canary',
    ]);

    expect(suggestedTag).toBeNull();
  });

  test('should ignore invalid include/exclude regex and continue', () => {
    const warn = vi.fn();
    const container = createContainer({
      includeTags: '[',
      excludeTags: '(',
      image: { tag: { value: 'latest' } },
    });

    expect(suggest(container as any, ['1.0.0', '2.0.0'], { warn })).toBe('2.0.0');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('should preserve string errors thrown by regex compilation', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw 'raw regex failure';
    });
    const warn = vi.fn();

    try {
      const container = createContainer({
        includeTags: 'anything',
        image: { tag: { value: 'latest' } },
      });

      expect(suggest(container as any, ['1.0.0'], { warn })).toBe('1.0.0');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('raw regex failure'));
    } finally {
      compileSpy.mockRestore();
    }
  });

  test('should stringify non-Error objects without a message field from regex compilation', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementation(() => {
      throw { reason: 'opaque-failure' };
    });
    const warn = vi.fn();

    try {
      const container = createContainer({
        includeTags: 'anything',
        image: { tag: { value: 'latest' } },
      });

      expect(suggest(container as any, ['1.0.0'], { warn })).toBe('1.0.0');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[object Object]'));
    } finally {
      compileSpy.mockRestore();
    }
  });

  test('should ignore overlong include regex and continue without include filtering', () => {
    const warn = vi.fn();
    const container = createContainer({
      includeTags: 'a'.repeat(1025),
      image: { tag: { value: 'latest' } },
    });

    expect(suggest(container as any, ['1.0.0', '2.0.0'], { warn })).toBe('2.0.0');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Regex pattern exceeds maximum length'),
    );
  });

  test('should drop semver candidates that only have prerelease metadata', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['1.2.3-ls132', '1.2.2'])).toBe('1.2.2');
  });

  test('should drop candidates with non-integer semver components', () => {
    const parseSpy = vi.spyOn(semver, 'parse').mockImplementation((tag: string) => {
      if (tag === 'bad-int') {
        return {
          major: 1.5,
          minor: 0,
          patch: 0,
          prerelease: [],
        } as any;
      }
      return null;
    });

    try {
      const container = createContainer({ image: { tag: { value: 'latest' } } });
      expect(suggest(container as any, ['bad-int'])).toBeNull();
    } finally {
      parseSpy.mockRestore();
    }
  });

  test('should suggest the latest stable release when a PEP 440 dev nightly is present (regression #473)', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, ['2026.7.1', '2026.8.0.dev202607050315']);

    expect(suggestedTag).toBe('2026.7.1');
  });

  test('should reject a PEP 440 post-release suffix that would be lost by coercion', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, ['1.2.2', '1.2.3.post1']);

    expect(suggestedTag).toBe('1.2.2');
  });

  test('should reject a dotted dev suffix without trailing digits', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, ['1.2.2', '1.2.3.dev']);

    expect(suggestedTag).toBe('1.2.2');
  });

  test('should return null when only coercion-lossy OS-variant tags are available', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    const suggestedTag = suggest(container as any, ['3.11-bullseye', '3.11.4-bullseye']);

    expect(suggestedTag).toBeNull();
  });

  test('should still accept a bare two-part numeric version', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['13.4'])).toBe('13.4');
  });

  test('should still accept a v-prefixed zero-padded version', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['v01.2.3'])).toBe('v01.2.3');
  });

  test('should still accept a stable version with build metadata', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['1.2.3+build.5'])).toBe('1.2.3+build.5');
  });

  test('should reject a hyphenated CalVer date that only parses via coercion', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['2024-01-15'])).toBeNull();
  });

  test('should prefer the higher patch version when major and minor are tied', () => {
    const container = createContainer({ image: { tag: { value: 'latest' } } });

    expect(suggest(container as any, ['2.5.1', '2.5.9'])).toBe('2.5.9');
  });

  test('should drop candidates with non-integer semver components when coercion was not required', () => {
    const parseSpy = vi.spyOn(semver, 'parse').mockImplementation((tag: string) => {
      if (tag === '9.9.9') {
        return {
          major: 9.5,
          minor: 0,
          patch: 0,
        } as any;
      }
      return null;
    });

    try {
      const container = createContainer({ image: { tag: { value: 'latest' } } });
      expect(suggest(container as any, ['9.9.9'])).toBeNull();
    } finally {
      parseSpy.mockRestore();
    }
  });

  // #859: linuxserver/plex repro — a bare integer build-number tag ("168")
  // coerces via semver.coerce() into a fake "168.0.0" that outranks a real
  // dotted release ("1.43.3"). A bare integer must never be compared against
  // a real version directly; see tag/version-population.ts.
  describe('bare integer tags never outrank real dotted versions (#859)', () => {
    test('picks the highest dotted version over a bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['latest', '168', '1.43.2', '1.43.3'])).toBe('1.43.3');
    });

    test('picks the highest dotted version over a bare integer regardless of input order', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['1.43.3', '1.43.2', '168', 'latest'])).toBe('1.43.3');
    });

    test('picks the highest v-prefixed dotted version over a v-prefixed bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['v168', 'v1.43.2', 'v1.43.3'])).toBe('v1.43.3');
    });

    test('the literal issue #859 repro: 168 vs 1.43.3', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['168', '1.43.3'])).toBe('1.43.3');
    });

    test('a two-part version beats a numerically larger bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['13.4', '168'])).toBe('13.4');
    });

    test('a two-part version beats multiple numerically larger bare integers', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['168', '169', '13.4'])).toBe('13.4');
    });

    test('in-tier magnitude comparison is untouched by this change', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['13.4', '13.4.2'])).toBe('13.4.2');
    });

    test('CalVer beats a numerically larger bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['latest', '9999', '2026.7.1', '2026.8.0'])).toBe(
        '2026.8.0',
      );
    });

    test('CalVer behavior is unaffected when no bare integer is present', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['2026.7.1', '2026.8.0'])).toBe('2026.8.0');
    });

    test('a genuinely integer-only pool still works, sorted numerically', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['latest', '166', '168', '167'])).toBe('168');
    });

    test('a genuinely integer-only pool sorts numerically, not lexically', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['latest', 'v9', 'v10'])).toBe('v10');
    });

    test('returns null for a mixed signal: prerelease-only real version + bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['168', '1.44.0-rc.1'])).toBeNull();
    });

    test('returns null when a coercion-lossy tag counts as a non-integer version signal', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['168', '3.11-bullseye'])).toBeNull();
    });

    test('preserves existing PEP 440 dev-nightly behavior alongside a bare integer', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['168', '2026.8.0.dev202607050315', '2026.7.1'])).toBe(
        '2026.7.1',
      );
    });

    test('an unadorned tag wins a tie against the same core with build metadata', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['1.43.3+build.5', '1.43.3'])).toBe('1.43.3');
    });

    test('an unadorned tag wins a tie against build metadata regardless of input order', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['1.43.3', '1.43.3+build.5'])).toBe('1.43.3');
    });

    test('excludeTags narrows the population before classification', () => {
      const container = createContainer({
        image: { tag: { value: 'latest' } },
        excludeTags: '^168$',
      });

      expect(suggest(container as any, ['168', '1.43.3'])).toBe('1.43.3');
    });

    test('includeTags narrows the population to integers-only before classification, so the integer wins', () => {
      const container = createContainer({
        image: { tag: { value: 'latest' } },
        includeTags: String.raw`^\d+$`,
      });

      expect(suggest(container as any, ['168', '1.43.3'])).toBe('168');
    });

    test('breaks a same-version, no-build-metadata tie deterministically by tag text', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['v1.2.3', '1.2.3'])).toBe('1.2.3');
    });

    test('breaks a same-version, no-build-metadata tie deterministically regardless of input order', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['1.2.3', 'v1.2.3'])).toBe('1.2.3');
    });

    test('breaks a same-version tie deterministically when both candidates share the exact tag text', () => {
      const container = createContainer({ image: { tag: { value: 'latest' } } });

      expect(suggest(container as any, ['1.2.3', '1.2.3'])).toBe('1.2.3');
    });
  });
});
