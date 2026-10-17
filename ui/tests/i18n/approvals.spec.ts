import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import english from '@/locales/en/approvalsView.json';

function leafEntries(value: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string'
      ? [[path, child] as [string, string]]
      : leafEntries(child as Record<string, unknown>, path);
  });
}

describe('approval catalogs', () => {
  const originalLocale = i18n.global.locale.value;
  // These technical terms are also used unchanged in the target languages.
  const sharedKeys: Record<string, string[]> = {
    fr: ['columns.image', 'columns.version'],
    de: ['columns.container', 'columns.image', 'columns.version', 'columns.scan', 'semver.patch'],
    nl: ['columns.container', 'columns.image', 'columns.scan', 'semver.patch'],
    it: ['columns.container', 'semver.patch'],
  };

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it.each([
    ['fr', 0, '0 affichées'],
    ['fr', 1, '1 affichée'],
    ['fr', 3, '3 affichées'],
    ['es', 0, '0 mostradas'],
    ['es', 1, '1 mostrada'],
    ['es', 3, '3 mostradas'],
  ] as const)('renders the %s count %s as %s', (locale, count, expected) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.t('approvalsView.ofCount', { count })).toBe(expected);
  });

  it.each([
    ['ar', 'المعروض: {count}'],
    ['de', '{count} angezeigt'],
    ['it', 'Elementi mostrati: {count}'],
    ['ja', '{count} 件表示'],
    ['ko', '{count}개 표시'],
    ['nl', '{count} weergegeven'],
    ['pl', 'Wyświetlono: {count}'],
    ['pt-BR', 'Exibidos: {count}'],
    ['ru', 'Показано: {count}'],
    ['tr', 'Gösterilen: {count}'],
    ['uk', 'Показано: {count}'],
    ['vi', 'Đã hiển thị: {count}'],
    ['zh-CN', '已显示 {count} 项'],
    ['zh-TW', '已顯示 {count} 項'],
  ] as const)('renders zero, one and multiple entries in %s', (locale, pattern) => {
    i18n.global.locale.value = locale;
    for (const count of [0, 1, 3]) {
      expect(i18n.global.t('approvalsView.ofCount', { count })).toBe(
        pattern.replace('{count}', String(count)),
      );
    }
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    'translates every approval message in %s',
    (locale) => {
      i18n.global.locale.value = locale;
      for (const [key, source] of leafEntries(english)) {
        const translated = i18n.global.t(key, {
          count: 3,
          name: 'app',
          toRef: '2.0',
          days: 7,
          list: 'reason',
        });
        expect(translated, key).not.toBe(key);
        expect(translated.trim(), key).not.toBe('');
        expect(translated, key).not.toMatch(/\{(?:count|name|toRef|days|list)\}/);
        if (!sharedKeys[locale]?.includes(key.replace('approvalsView.', ''))) {
          const renderedEnglish = source.replace(
            /\{(count|name|toRef|days|list)\}/g,
            (_, name: string) =>
              ({ count: '3', name: 'app', toRef: '2.0', days: '7', list: 'reason' })[name]!,
          );
          expect(translated, key).not.toBe(renderedEnglish);
        }
      }
    },
  );
});
