import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

const repoRoot = resolve(import.meta.dirname, '../../..');
const supportedTranslationLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en').sort();

const expectedCrowdinLocaleMapping = {
  de: 'de',
  'es-ES': 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  nl: 'nl',
  pl: 'pl',
  'pt-BR': 'pt-BR',
  tr: 'tr',
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

  it('downloads only the Crowdin languages exposed in the app locale picker', () => {
    const workflow = asRecord(readYaml('.github/workflows/i18n-crowdin.yml'));
    const jobs = asRecord(workflow.jobs);
    const sync = asRecord(jobs.sync);
    const steps = sync.steps;
    expect(Array.isArray(steps)).toBe(true);

    const crowdinStep = steps
      .map((step) => asRecord(step))
      .find((step) => String(step.uses ?? '').startsWith('crowdin/github-action@'));
    expect(crowdinStep).toBeTruthy();

    const withConfig = asRecord(crowdinStep?.with);
    const args = String(withConfig.download_translations_args ?? '');
    const downloadedLanguages = Array.from(args.matchAll(/--language=(\S+)/g), (match) => match[1]);
    const downloadedLocales = downloadedLanguages.map(
      (language) =>
        expectedCrowdinLocaleMapping[language as keyof typeof expectedCrowdinLocaleMapping],
    );

    expect(downloadedLanguages.sort()).toEqual(Object.keys(expectedCrowdinLocaleMapping).sort());
    expect(downloadedLocales.sort()).toEqual(supportedTranslationLocales);
  });
});
