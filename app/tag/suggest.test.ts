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
});
