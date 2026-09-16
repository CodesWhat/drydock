import { i18n } from '@/boot/i18n';
import english from '@/locales/en/approvalsView.json';

function leafEntries(value: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'string'
      ? [[path, child] as [string, string]]
      : leafEntries(child as Record<string, unknown>, path);
  });
}

describe('French and Spanish approval catalogs', () => {
  const originalLocale = i18n.global.locale.value;
  // Image and Version are also French words.
  const sharedFrenchKeys = new Set([
    'approvalsView.columns.image',
    'approvalsView.columns.version',
  ]);

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

  it.each(['fr', 'es'] as const)('translates every approval message in %s', (locale) => {
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
      if (locale !== 'fr' || !sharedFrenchKeys.has(key)) {
        const renderedEnglish = source.replace(
          /\{(count|name|toRef|days|list)\}/g,
          (_, name: string) =>
            ({ count: '3', name: 'app', toRef: '2.0', days: '7', list: 'reason' })[name]!,
        );
        expect(translated, key).not.toBe(renderedEnglish);
      }
    }
  });
});
