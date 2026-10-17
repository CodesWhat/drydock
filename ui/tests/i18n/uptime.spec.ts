import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';

it.each(SUPPORTED_LOCALES)('provides a complete uptime phrase in %s', (locale) => {
  expect(i18n.global.te('common.uptime', locale)).toBe(true);
  const value = i18n.global.t('common.uptime', { duration: '12h 34m' }, { locale });
  expect(value).toContain('12h 34m');
  expect(value).not.toContain('{duration}');
  expect(value).not.toBe('common.uptime');
  if (locale !== 'en') expect(value).not.toBe('Up 12h 34m');
});
