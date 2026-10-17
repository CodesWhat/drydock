import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';

function messages(locale: string) {
  return JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../src/locales/${locale}/containerComponents.json`,
      ),
      'utf8',
    ),
  ).containerComponents.fleetHealth;
}

it.each(SUPPORTED_LOCALES)(
  'provides every fleet health message and interpolation in %s',
  (locale) => {
    const english = messages('en');
    const translated = messages(locale);
    expect(translated).toBeDefined();
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(english)) {
      expect(typeof translated[key]).toBe('string');
      expect(new Set(translated[key].match(/\{\w+\}/g) ?? [])).toEqual(
        new Set((value as string).match(/\{\w+\}/g) ?? []),
      );
    }
  },
);
