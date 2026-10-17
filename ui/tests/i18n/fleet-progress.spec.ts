import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import english from '@/locales/en/containerComponents.json';

const keys = [
  'fleetUpdateProgress',
  'fleetUpdateProgressRunning',
  'fleetUpdateProgressRunningMore',
] as const;

describe('fleet update progress translations', () => {
  const originalLocale = i18n.global.locale.value;

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it.each(SUPPORTED_LOCALES)('translates progress without losing parameters in %s', (locale) => {
    i18n.global.locale.value = locale;
    const messages = i18n.global.getLocaleMessage(locale).containerComponents as {
      listContent: Record<string, string>;
    };
    for (const key of keys) {
      const source = english.containerComponents.listContent[key];
      const translated = messages.listContent[key];
      expect(typeof translated).toBe('string');
      expect(translated.trim()).not.toBe('');
      expect(translated.match(/\{\w+\}/g)?.sort()).toEqual(source.match(/\{\w+\}/g)?.sort());
      if (locale !== 'en') expect(translated).not.toBe(source);

      const path = `containerComponents.listContent.${key}`;
      const rendered = i18n.global.t(path, { done: 2, total: 7, names: 'api, db', more: 4 });
      expect(rendered).not.toBe(path);
      expect(rendered).not.toMatch(/\{\w+\}/);
      if (key === 'fleetUpdateProgress') {
        expect(rendered).toContain('2');
        expect(rendered).toContain('7');
      } else {
        expect(rendered).toContain('api, db');
        if (key === 'fleetUpdateProgressRunningMore') expect(rendered).toContain('4');
      }
    }
  });
});
