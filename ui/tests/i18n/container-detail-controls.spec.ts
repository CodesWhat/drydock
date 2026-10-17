import { i18n, SUPPORTED_LOCALES, setI18nLocale } from '@/boot/i18n';

const keys = [
  'fullPageOverview.softwareVersion',
  'fullPageOverview.uptime',
  'fullPageOverview.uptimeAriaLabel',
  'containerLogs.tailCount',
  'containerLogs.tailAll',
  'containerLogs.statusPaused',
  'containerLogs.statusLive',
  'containerLogs.statusOffline',
  'updateDialog.thisContainer',
  'updateDialog.updateFailed',
  'confirmDialogs.cancel',
  'confirmDialogs.stop.header',
  'confirmDialogs.stop.message',
  'confirmDialogs.stop.acceptLabel',
  'confirmDialogs.stop.successMessage',
  'confirmDialogs.restart.header',
  'confirmDialogs.restart.message',
  'confirmDialogs.restart.acceptLabel',
  'confirmDialogs.restart.successMessage',
  'policy.entryCountSingular',
  'policy.entryCountPlural',
];

describe('container detail control translations', () => {
  afterEach(() => setI18nLocale('en'));

  it.each(SUPPORTED_LOCALES)('renders localized controls and parameters in %s', (locale) => {
    for (const key of keys) {
      const path = `containerComponents.${key}`;
      const parameters = { name: 'api-δ', count: 7 };
      setI18nLocale('en');
      const english = i18n.global.t(path, parameters);
      setI18nLocale(locale);
      expect(i18n.global.te(path, locale), path).toBe(true);
      const rendered = i18n.global.t(path, parameters);
      expect(rendered, path).not.toBe(path);
      expect(rendered.trim(), path).not.toBe('');
      expect(rendered, path).not.toMatch(/\{\w+\}/);
      if (locale !== 'en' && !(locale === 'nl' && key === 'confirmDialogs.stop.acceptLabel')) {
        expect(rendered, path).not.toBe(english);
      }
      if (english.includes('api-δ')) expect(rendered, path).toContain('api-δ');
      if (english.includes('7')) expect(rendered, path).toContain('7');
    }
  });
});
