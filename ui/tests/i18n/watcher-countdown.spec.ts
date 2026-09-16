import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';

it.each(SUPPORTED_LOCALES)('provides a translated watcher countdown fallback in %s', (locale) => {
  const key = 'watchersView.soon';
  expect(i18n.global.te(key, locale)).toBe(true);
  const text = i18n.global.t(key, {}, { locale });
  expect(text.trim()).not.toBe('');
  expect(text).not.toBe(key);
  if (locale !== 'en') expect(text).not.toBe('soon');
});
