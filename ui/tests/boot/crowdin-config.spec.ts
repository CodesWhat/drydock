import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

const repoRoot = resolve(import.meta.dirname, '../../..');
const supportedTranslationLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en').sort();

const expectedCrowdinLocaleMapping = {
  ar: 'ar',
  de: 'de',
  'es-ES': 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  nl: 'nl',
  pl: 'pl',
  'pt-BR': 'pt-BR',
  ru: 'ru',
  tr: 'tr',
  uk: 'uk',
  vi: 'vi',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
} as const;

function readYaml(path: string): unknown {
  return parse(readFileSync(resolve(repoRoot, path), 'utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function firstCrowdinFileSet(): Record<string, unknown> {
  const config = asRecord(readYaml('crowdin.yml'));
  const files = config.files;
  expect(Array.isArray(files)).toBe(true);
  expect(files).toHaveLength(1);
  return asRecord(files[0]);
}

describe('Crowdin locale export config', () => {
  it('maps Crowdin language codes to the locale folder IDs supported by the app', () => {
    const fileSet = firstCrowdinFileSet();

    expect(fileSet.translation).toBe('/ui/src/locales/%locale%/**/%original_file_name%');
    const localeMapping = asRecord(asRecord(fileSet.languages_mapping).locale);
    expect(localeMapping).toEqual(expectedCrowdinLocaleMapping);
    expect(Object.values(localeMapping).sort()).toEqual(supportedTranslationLocales);
  });

  it('leaves the language scoping to crowdin.yml instead of duplicating it in the workflow', () => {
    // crowdin.yml's languages_mapping is the single source of truth for which
    // locales are exported. The workflow used to mirror the list as
    // download_translations_args=--language=…; that duplication drifted away
    // from crowdin.yml during the security hardening pass, so the workflow
    // now relies on crowdin.yml alone. .github/tests/crowdin-workflow.test.ts
    // owns the workflow-side assertion; this test just verifies the UI's
    // expected mapping still aligns with the workspace config.
    const workflow = asRecord(readYaml('.github/workflows/i18n-crowdin.yml'));
    const jobs = asRecord(workflow.jobs);
    const sync = asRecord(jobs.sync);
    const steps = sync.steps as unknown[];

    const crowdinStep = steps
      .map((step) => asRecord(step))
      .find((step) => String(step.uses ?? '').startsWith('crowdin/github-action@'));
    expect(crowdinStep).toBeTruthy();

    const withConfig = asRecord(crowdinStep?.with);
    expect(withConfig.download_translations_args).toBeUndefined();

    const fileSet = firstCrowdinFileSet();
    const localeMapping = asRecord(asRecord(fileSet.languages_mapping).locale);
    expect(Object.keys(localeMapping).sort()).toEqual(
      Object.keys(expectedCrowdinLocaleMapping).sort(),
    );
    expect(Object.values(localeMapping).sort()).toEqual(supportedTranslationLocales);
  });
});
