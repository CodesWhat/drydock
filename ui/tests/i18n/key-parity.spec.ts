/**
 * Locale key parity gate — catches stale/orphan locale keys and structural corruption.
 *
 * Asymmetric by design (Crowdin-lag tolerant):
 *   - ORPHAN keys (present in a locale but absent from en) → FAIL (stale cruft, never legitimate)
 *   - MISSING keys (present in en but absent from a locale) → TOLERATED (Crowdin fills after push)
 *
 * Root-key parity only flags locale top-level keys that are absent from en (stale/corrupt);
 * locale files missing some of en's top-level keys are tolerated for the same Crowdin-lag reason.
 * Note: some namespace files (e.g. listViews.json) have multiple top-level keys by design.
 *
 * Right now there are legitimately-missing keys from the last push; this gate deliberately
 * does not fail on those. Reference: Crowdin flow + #329.
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

    // Missing keys (enLeaves not in locale) are TOLERATED — Crowdin lag is expected after push.
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
});
