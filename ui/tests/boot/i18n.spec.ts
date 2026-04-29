import { buildMessages, SUPPORTED_LOCALES } from '@/boot/i18n';

describe('buildMessages', () => {
  it('returns an object keyed by supported locales', () => {
    const result = buildMessages({});
    expect(result).toHaveProperty('en');
  });

  it('skips paths that do not match the /locales/<locale>/ pattern', () => {
    const modules = {
      // no /locales/<x>/ segment — should be silently skipped
      '../not-a-locale-path/en/foo.json': { hello: 'world' },
      '../locales/en/valid.json': { greeting: 'Hello' },
    };
    const result = buildMessages(modules);
    // Only the valid path contributes
    expect(result.en).toEqual({ greeting: 'Hello' });
    // The key from the non-matching path must NOT appear
    expect((result.en as Record<string, unknown>).hello).toBeUndefined();
  });

  it('skips paths whose locale segment is not in SUPPORTED_LOCALES', () => {
    const modules = {
      '../locales/fr/common.json': { bonjour: 'Bonjour' },
      '../locales/en/common.json': { hello: 'Hello' },
    };
    const result = buildMessages(modules);
    // fr is not supported — its keys must not appear
    expect((result as Record<string, unknown>).fr).toBeUndefined();
    expect(result.en).toEqual({ hello: 'Hello' });
  });

  it('merges multiple namespaces for the same supported locale', () => {
    const modules = {
      '../locales/en/common.json': { hello: 'Hello' },
      '../locales/en/containers.json': { update: 'Update' },
    };
    const result = buildMessages(modules);
    expect(result.en).toEqual({ hello: 'Hello', update: 'Update' });
  });

  it('returns all entries from SUPPORTED_LOCALES as top-level keys', () => {
    const result = buildMessages({});
    for (const locale of SUPPORTED_LOCALES) {
      expect(result).toHaveProperty(locale);
    }
  });
});
