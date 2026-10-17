import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';

describe('security scan count labels', () => {
  it.each(SUPPORTED_LOCALES)('provides local count labels in %s', (locale) => {
    for (const label of ['scanned', 'images']) {
      const key = `securityView.countLabel.${label}`;
      expect(i18n.global.te(key, locale)).toBe(true);
      const text = i18n.global.t(key, {}, { locale });
      expect(text.trim()).not.toBe('');
      expect(text).not.toBe(key);
      if (locale !== 'en' && !(['fr', 'nl'].includes(locale) && label === 'images')) {
        expect(text).not.toBe(label);
      }
    }
  });
});
