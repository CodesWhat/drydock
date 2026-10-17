import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createI18n } from 'vue-i18n';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/locales');

function load(locale: string) {
  return JSON.parse(readFileSync(join(localesDir, locale, 'totpFactor.json'), 'utf8')) as {
    totpFactor: {
      status: { recoveryRemaining: string };
      unavailable: { httpsRequired: string };
      codes: { filename: string };
    };
  };
}

describe('totpFactor locale namespace', () => {
  it.each(SUPPORTED_LOCALES)(
    '%s keeps the operator setting and the file name verbatim',
    (locale) => {
      const { totpFactor } = load(locale);

      expect(totpFactor.unavailable.httpsRequired).toContain('DD_AUTH_TOTP_ALLOWHTTP=true');
      expect(totpFactor.codes.filename).toBe('drydock-recovery-codes.txt');
    },
  );

  it.each(SUPPORTED_LOCALES)('%s renders the remaining-code count for one and many', (locale) => {
    const i18n = createI18n({
      legacy: false,
      locale,
      messages: { [locale]: load(locale) },
    });

    for (const count of [1, 10]) {
      const text = i18n.global.t('totpFactor.status.recoveryRemaining', { count }, count);
      expect(text).toContain(String(count));
      expect(text).not.toContain('{');
    }
  });

  it('pluralizes English', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: load('en') } });

    expect(i18n.global.t('totpFactor.status.recoveryRemaining', { count: 1 }, 1)).toBe(
      '1 recovery code left',
    );
    expect(i18n.global.t('totpFactor.status.recoveryRemaining', { count: 10 }, 10)).toBe(
      '10 recovery codes left',
    );
  });
});
