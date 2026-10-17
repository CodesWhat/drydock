import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/locales');
const onDisk = new Set(
  readdirSync(localesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);
const canonical = new Set<string>(SUPPORTED_LOCALES);

describe('locale directories', () => {
  test('no stray directories under ui/src/locales/', () => {
    const stray = [...onDisk].filter((d) => !canonical.has(d));
    expect(stray, `stray dirs not in SUPPORTED_LOCALES: ${stray.join(', ')}`).toHaveLength(0);
  });

  test('every SUPPORTED_LOCALE has a directory under ui/src/locales/', () => {
    const missing = [...canonical].filter((l) => !onDisk.has(l));
    expect(missing, `locales missing from disk: ${missing.join(', ')}`).toHaveLength(0);
  });
});

describe('recent relative-time translations', () => {
  test.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    '%s has a translated shared just-now label',
    (locale) => {
      const catalog = JSON.parse(readFileSync(resolve(localesDir, locale, 'common.json'), 'utf8'));
      const value = catalog.common.timeAgo.justNow;
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
      expect(value.trim().toLowerCase()).not.toBe('just now');
    },
  );
});
