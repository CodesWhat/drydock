import { buildMessages, i18n, LOCALE_OPTIONS, SUPPORTED_LOCALES, setI18nLocale } from '@/boot/i18n';

function getMessagePath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);
}

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

  it('exposes Dutch as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('nl');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'nl', label: 'Nederlands' });
  });

  it('exposes Polish as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('pl');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'pl', label: 'Polski' });
  });

  it('exposes Turkish as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('tr');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'tr', label: 'Türkçe' });
  });

  it('exposes Japanese as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('ja');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'ja', label: '日本語' });
  });

  it('exposes Korean as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('ko');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'ko', label: '한국어' });
  });

  it('exposes Russian as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('ru');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'ru', label: 'Русский' });
  });

  it('exposes Vietnamese as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('vi');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'vi', label: 'Tiếng Việt' });
  });

  it('exposes Ukrainian as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('uk');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'uk', label: 'Українська' });
  });

  it('exposes Arabic as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('ar');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'ar', label: 'العربية' });
  });

  it('exposes Traditional Chinese as a supported picker option', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-TW');
    expect(LOCALE_OPTIONS).toContainEqual({ id: 'zh-TW', label: '繁體中文' });
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
      '../locales/xx/common.json': { hello: 'unknown' },
      '../locales/en/common.json': { hello: 'Hello' },
    };
    const result = buildMessages(modules);
    // xx is not supported — its keys must not appear
    expect((result as Record<string, unknown>).xx).toBeUndefined();
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

  it('handles locale codes with hyphens (e.g. zh-CN and zh-TW)', () => {
    const modules = {
      '../locales/zh-CN/common.json': { hello: '你好' },
      '../locales/zh-TW/common.json': { hello: '你好' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>)['zh-CN']).toEqual({ hello: '你好' });
    expect((result as Record<string, unknown>)['zh-TW']).toEqual({ hello: '你好' });
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

  it('handles Dutch locale namespaces', () => {
    const modules = {
      '../locales/nl/common.json': { hello: 'Hallo' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).nl).toEqual({ hello: 'Hallo' });
  });

  it('handles Polish locale namespaces', () => {
    const modules = {
      '../locales/pl/common.json': { hello: 'Cześć' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).pl).toEqual({ hello: 'Cześć' });
  });

  it('handles Turkish locale namespaces', () => {
    const modules = {
      '../locales/tr/common.json': { hello: 'Merhaba' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).tr).toEqual({ hello: 'Merhaba' });
  });

  it('handles Japanese locale namespaces', () => {
    const modules = {
      '../locales/ja/common.json': { hello: 'こんにちは' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).ja).toEqual({ hello: 'こんにちは' });
  });

  it('handles Korean locale namespaces', () => {
    const modules = {
      '../locales/ko/common.json': { hello: '안녕하세요' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).ko).toEqual({ hello: '안녕하세요' });
  });

  it('handles Russian locale namespaces', () => {
    const modules = {
      '../locales/ru/common.json': { hello: 'Привет' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).ru).toEqual({ hello: 'Привет' });
  });

  it('handles Vietnamese locale namespaces', () => {
    const modules = {
      '../locales/vi/common.json': { hello: 'Xin chào' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).vi).toEqual({ hello: 'Xin chào' });
  });

  it('handles Ukrainian locale namespaces', () => {
    const modules = {
      '../locales/uk/common.json': { hello: 'Привіт' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).uk).toEqual({ hello: 'Привіт' });
  });

  it('handles Arabic locale namespaces', () => {
    const modules = {
      '../locales/ar/common.json': { hello: 'مرحبا' },
    };
    const result = buildMessages(modules);
    expect((result as Record<string, unknown>).ar).toEqual({ hello: 'مرحبا' });
  });

  it('translates the Outbox sidebar label in every supported locale', () => {
    const messages = buildMessages();

    for (const locale of SUPPORTED_LOCALES) {
      const label = getMessagePath(messages[locale], 'appShell.layout.nav.outbox');
      expect(label, `${locale} missing appShell.layout.nav.outbox`).toBeTypeOf('string');
      expect(label, `${locale} appShell.layout.nav.outbox should not be empty`).not.toBe('');
    }
  });

  it('translates appearance choice descriptions and previews in every supported locale', () => {
    const messages = buildMessages();
    const descriptionKeys = ['oneDark', 'github', 'dracula', 'catppuccin', 'gruvbox', 'ayu'];
    const radiusLabelKeys = ['none', 'sharp', 'modern', 'soft', 'round'];
    const englishPreview = getMessagePath(messages.en, 'configView.appearance.fontFamily.preview');

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of descriptionKeys) {
        const label = getMessagePath(
          messages[locale],
          `configView.appearance.colorTheme.descriptions.${key}`,
        );
        expect(
          label,
          `${locale} missing configView.appearance.colorTheme.descriptions.${key}`,
        ).toBeTypeOf('string');
        expect(
          label,
          `${locale} configView.appearance.colorTheme.descriptions.${key} should not be empty`,
        ).not.toBe('');
      }

      for (const key of radiusLabelKeys) {
        const label = getMessagePath(
          messages[locale],
          `configView.appearance.borderRadius.labels.${key}`,
        );
        expect(
          label,
          `${locale} missing configView.appearance.borderRadius.labels.${key}`,
        ).toBeTypeOf('string');
        expect(
          label,
          `${locale} configView.appearance.borderRadius.labels.${key} should not be empty`,
        ).not.toBe('');
      }

      const preview = getMessagePath(messages[locale], 'configView.appearance.fontFamily.preview');
      expect(preview, `${locale} missing configView.appearance.fontFamily.preview`).toBeTypeOf(
        'string',
      );
      expect(
        preview,
        `${locale} configView.appearance.fontFamily.preview should not be empty`,
      ).not.toBe('');
      if (locale !== 'en') {
        expect(preview, `${locale} should localize the font preview sentence`).not.toBe(
          englishPreview,
        );
      }
    }
  });

  it('keeps legacy-trigger banner titles localized in every non-English locale', () => {
    const messages = buildMessages();
    const titleKeys = ['legacyConfigTitleSingular', 'legacyConfigTitlePlural'];

    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en')) {
      for (const key of titleKeys) {
        const path = `appShell.banners.${key}`;
        const localizedTitle = getMessagePath(messages[locale], path);
        const englishTitle = getMessagePath(messages.en, path);

        expect(localizedTitle, `${locale} missing ${path}`).toBeTypeOf('string');
        expect(localizedTitle, `${locale} should localize ${path}`).not.toBe(englishTitle);
      }
    }
  });

  it('sources the pinned update-status summary from groupedViews.pinnedLabel', () => {
    // #display-honesty: the dedicated updateStatus.summary.pinned key was retired —
    // deriveUpdateStatus() now reuses groupedViews.pinnedLabel (the same label the
    // table/card update-state pill shows) so there's one pinned vocabulary, not two.
    const messages = buildMessages();
    const path = 'containerComponents.groupedViews.pinnedLabel';
    const englishSummary = getMessagePath(messages.en, path);

    expect(englishSummary, `en missing ${path}`).toBeTypeOf('string');
    expect(englishSummary, `en ${path} should not be empty`).not.toBe('');
    expect(englishSummary, `en ${path} should carry the {tag} interpolation`).toContain('{tag}');

    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en')) {
      const localizedSummary = getMessagePath(messages[locale], path);
      // groupedViews.pinnedLabel is a reused pre-existing key still working through
      // Crowdin sync for non-English locales (same lag as its groupedViews.skippedLabel
      // neighbor) — only assert real translation when the key is actually present, so
      // this guard doesn't block on sync lag unrelated to the display-honesty batch,
      // while still catching a verbatim English copy where the key IS present.
      if (localizedSummary === undefined) continue;
      expect(localizedSummary, `${locale} ${path} should not be empty`).not.toBe('');
      expect(localizedSummary, `${locale} should localize ${path}`).not.toBe(englishSummary);
    }
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

  it('updates the vue-i18n global locale when document is unavailable', () => {
    const originalDocument = globalThis.document;
    try {
      vi.stubGlobal('document', undefined);
      setI18nLocale('zh-TW');

      expect(i18n.global.locale.value).toBe('zh-TW');
    } finally {
      vi.stubGlobal('document', originalDocument);
    }
  });
});
