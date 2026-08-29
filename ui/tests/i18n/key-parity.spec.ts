/**
 * Locale key parity gate — catches stale/orphan locale keys, missing keys, and
 * structural corruption.
 *
 *   - ORPHAN keys (present in a locale but absent from en) → FAIL (stale cruft, never legitimate)
 *   - MISSING keys (present in en but absent from a locale) → FAIL
 *
 * Missing keys used to be tolerated on the grounds that Crowdin would fill them
 * after the push. It does not. Crowdin exports source text for anything it has
 * no translation for, so the sync PR "fills" the gap with verbatim English,
 * which renders identically to the fallback but is now indistinguishable from a
 * real translation to any later check. The eleven action-policy badge and
 * tooltip keys sat English-only in all sixteen locales for several releases
 * that way, and were found by a one-off scan rather than by CI.
 *
 * The cost of failing instead is that a PR adding a UI string has to translate
 * it in the same change. That is the intended trade: the alternative is
 * shipping English to non-English users and finding out later.
 *
 * A brand-new namespace file that a locale does not have yet is still tolerated,
 * because that is a file-creation race rather than an untranslated string.
 *
 * Root-key parity flags locale top-level keys that are absent from en. Note that
 * some namespace files (e.g. listViews.json) have multiple top-level keys by design.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/locales');
const enNamespaces = readdirSync(join(localesDir, 'en')).filter((f) => f.endsWith('.json'));
const nonEnLocales = SUPPORTED_LOCALES.filter((l) => l !== 'en');

/** Returns all dotted leaf paths from an object. Recurses into plain objects only. */
function leafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(...leafKeys(v, path));
  }
  return keys;
}

interface RootKeyViolation {
  locale: string;
  namespace: string;
  extraKey: string;
}

interface OrphanViolation {
  locale: string;
  namespace: string;
  key: string;
}

const rootKeyViolations: RootKeyViolation[] = [];
const orphanViolations: OrphanViolation[] = [];
const missingViolations: OrphanViolation[] = [];

for (const locale of nonEnLocales) {
  for (const nsFile of enNamespaces) {
    const localeFilePath = join(localesDir, locale, nsFile);
    if (!existsSync(localeFilePath)) {
      // Tolerated: Crowdin may not have created a brand-new namespace yet for this locale
      continue;
    }

    let enObj: unknown;
    try {
      enObj = JSON.parse(readFileSync(join(localesDir, 'en', nsFile), 'utf-8'));
    } catch {
      throw new Error(`invalid JSON in en/${nsFile}`);
    }

    let localeObj: unknown;
    try {
      localeObj = JSON.parse(readFileSync(localeFilePath, 'utf-8'));
    } catch {
      throw new Error(`invalid JSON in ${locale}/${nsFile}`);
    }

    const enTopKeySet = new Set(Object.keys(enObj as Record<string, unknown>));
    const localeTopKeys = Object.keys(localeObj as Record<string, unknown>);

    // Root-key violation: any top-level key in locale that en doesn't have = structural corruption.
    // Locale missing some of en's top-level keys is tolerated (Crowdin lag, same as leaf keys).
    for (const k of localeTopKeys) {
      if (!enTopKeySet.has(k)) {
        rootKeyViolations.push({ locale, namespace: nsFile, extraKey: k });
      }
    }

    // Orphan leaf check: any dotted-path leaf in locale that en doesn't have.
    const enLeafSet = new Set(leafKeys(enObj));
    const localeLeaves = leafKeys(localeObj);

    for (const k of localeLeaves) {
      if (!enLeafSet.has(k)) {
        orphanViolations.push({ locale, namespace: nsFile, key: k });
      }
    }

    // Missing leaf check: any dotted-path leaf in en that this locale does not have.
    const localeLeafSet = new Set(localeLeaves);
    for (const k of enLeafSet) {
      if (!localeLeafSet.has(k)) {
        missingViolations.push({ locale, namespace: nsFile, key: k });
      }
    }
  }
}

describe('key-parity', () => {
  test("locale files self-wrap under en's root key", () => {
    const message =
      rootKeyViolations.length === 0
        ? ''
        : 'Root key mismatches (locale has top-level key absent from en):\n' +
          rootKeyViolations
            .map((v) => `  ${v.locale}/${v.namespace}: extra key "${v.extraKey}"`)
            .join('\n');
    expect(rootKeyViolations, message).toHaveLength(0);
  });

  test('no orphan keys in any locale (keys absent from en)', () => {
    const message =
      orphanViolations.length === 0
        ? ''
        : 'Orphan keys (present in locale but absent from en):\n' +
          orphanViolations.map((v) => `  ${v.locale}/${v.namespace}: ${v.key}`).join('\n');
    expect(orphanViolations, message).toHaveLength(0);
  });

  test('no missing keys in any locale (keys present in en)', () => {
    const byLocale = new Map<string, number>();
    for (const v of missingViolations) {
      byLocale.set(v.locale, (byLocale.get(v.locale) ?? 0) + 1);
    }
    const message =
      missingViolations.length === 0
        ? ''
        : `Missing keys (present in en, absent from a locale) — ${missingViolations.length} across ` +
          `${byLocale.size} locale(s). Translate them in this change; Crowdin will fill them with ` +
          'verbatim English, not a translation.\n' +
          missingViolations
            .slice(0, 40)
            .map((v) => `  ${v.locale}/${v.namespace}: ${v.key}`)
            .join('\n') +
          (missingViolations.length > 40 ? `\n  ...and ${missingViolations.length - 40} more` : '');
    expect(missingViolations, message).toHaveLength(0);
  });
});
