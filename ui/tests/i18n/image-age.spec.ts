import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';

it.each(SUPPORTED_LOCALES)('translates the image-age now label in %s', (locale) => {
  const key = 'common.imageAge.now';
  expect(i18n.global.te(key, locale)).toBe(true);
  const value = i18n.global.t(key, {}, { locale });
  expect(value.trim()).not.toBe('');
  expect(value).not.toBe(key);
  if (locale !== 'en') expect(value).not.toBe('now');
});
