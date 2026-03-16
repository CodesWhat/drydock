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
});
