/**
 * Locale placeholder parity gate — catches interpolation corruption in translated strings.
 *
 * A translated value has to carry exactly the same `{placeholder}` names as its English
 * source. Drop one and the fact it was meant to interpolate just vanishes from the rendered
 * string; invent one and vue-i18n renders the literal braces to the user. Neither shows up
 * in key-parity, which only compares key structure, and neither breaks JSON parsing, so
 * without this gate a bad translation ships looking perfectly well-formed.
 *
 * Set comparison, not sequence: word order legitimately moves a placeholder within a
 * sentence, and vue-i18n plural forms (`one | other`) legitimately repeat one on both
 * sides of the pipe. Only the *names* present have to match.
 *
 * Keys absent from a locale are skipped for the same Crowdin-lag reason key-parity
 * tolerates them.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/locales');
const enNamespaces = readdirSync(join(localesDir, 'en')).filter((f) => f.endsWith('.json'));
const nonEnLocales = SUPPORTED_LOCALES.filter((l) => l !== 'en');

/**
 * Matches vue-i18n named interpolation only. Deliberately excludes vue-i18n literal
 * escapes such as `{'@'}` (the leading quote fails the identifier class) so a legitimate
 * escape is not reported as a placeholder mismatch.
 */
const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

/** Returns all dotted leaf paths and their values. Recurses into plain objects only. */
function leafEntries(obj: unknown, prefix = ''): Array<[string, unknown]> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return prefix ? [[prefix, obj]] : [];
  }
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...leafEntries(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

function placeholders(value: string): Set<string> {
  return new Set(value.match(PLACEHOLDER) ?? []);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

interface PlaceholderViolation {
  locale: string;
  namespace: string;
  key: string;
  missing: string[];
  unexpected: string[];
}

const violations: PlaceholderViolation[] = [];

for (const nsFile of enNamespaces) {
  const enEntries = new Map(
    leafEntries(readJson(join(localesDir, 'en', nsFile))).filter(
      ([, v]) => typeof v === 'string',
    ) as Array<[string, string]>,
  );

  for (const locale of nonEnLocales) {
    const localeFilePath = join(localesDir, locale, nsFile);
    if (!existsSync(localeFilePath)) {
      continue;
    }
    const localeEntries = new Map(leafEntries(readJson(localeFilePath)));

    for (const [key, enValue] of enEntries) {
      const translated = localeEntries.get(key);
      if (typeof translated !== 'string') {
        // Absent or non-string: key-parity owns that case.
        continue;
      }
      const expected = placeholders(enValue);
      const actual = placeholders(translated);
      const missing = [...expected].filter((p) => !actual.has(p));
      const unexpected = [...actual].filter((p) => !expected.has(p));
      if (missing.length > 0 || unexpected.length > 0) {
        violations.push({ locale, namespace: nsFile, key, missing, unexpected });
      }
    }
  }
}

describe('placeholder-parity', () => {
  test('every translated string carries exactly its English placeholder set', () => {
    const report = violations
      .map(
        ({ locale, namespace, key, missing, unexpected }) =>
          `${locale}/${namespace} ${key}` +
          (missing.length > 0 ? ` missing=${missing.join(',')}` : '') +
          (unexpected.length > 0 ? ` unexpected=${unexpected.join(',')}` : ''),
      )
      .join('\n');
    expect(report).toBe('');
  });
});
