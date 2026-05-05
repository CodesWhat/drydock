import { buildMessages, i18n, LOCALE_OPTIONS, SUPPORTED_LOCALES, setI18nLocale } from '@/boot/i18n';

describe('buildMessages', () => {
  it('returns an object keyed by supported locales', () => {
    const result = buildMessages({});
    expect(result).toHaveProperty('en');
  });

  it('exposes Italian as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('it');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'it', label: 'Italiano' });
  });

  it('exposes Spanish as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'es', label: 'Español' });
  });

  it('exposes German as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('de');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'de', label: 'Deutsch' });
  });

  it('exposes French as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('fr');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'fr', label: 'Français' });
  });

  it('exposes Brazilian Portuguese as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('pt-BR');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'pt-BR', label: 'Português (Brasil)' });
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
      '../locales/ja/common.json': { hello: 'こんにちは' },
      '../locales/en/common.json': { hello: 'Hello' },
    };
    const result = buildMessages(modules);
    // ja is not supported — its keys must not appear
    expect((result as Record<string, unknown>).ja).toBeUndefined();
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

  it('handles locale codes with hyphens (e.g. zh-CN)', () => {
    const modules = {
      '../locales/zh-CN/common.json': { hello: '你好' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>)['zh-CN']).toEqual({ hello: '你好' });
  });

  it('handles Italian locale namespaces', () => {
    const modules = {
      '../locales/it/common.json': { hello: 'Ciao' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).it).toEqual({ hello: 'Ciao' });
  });

  it('handles Spanish locale namespaces', () => {
    const modules = {
      '../locales/es/common.json': { hello: 'Hola' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).es).toEqual({ hello: 'Hola' });
  });

  it('handles German locale namespaces', () => {
    const modules = {
      '../locales/de/common.json': { hello: 'Hallo' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).de).toEqual({ hello: 'Hallo' });
  });

  it('handles French locale namespaces', () => {
    const modules = {
      '../locales/fr/common.json': { hello: 'Bonjour' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).fr).toEqual({ hello: 'Bonjour' });
  });

  it('handles Brazilian Portuguese locale namespaces', () => {
    const modules = {
      '../locales/pt-BR/common.json': { hello: 'Olá' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>)['pt-BR']).toEqual({ hello: 'Olá' });
  });
});

describe('setI18nLocale', () => {
  afterEach(() => {
    setI18nLocale('en');
  });

  it('updates the vue-i18n global locale and document language', () => {
    setI18nLocale('zh-CN');

    expect(i18n.global.locale.value).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
