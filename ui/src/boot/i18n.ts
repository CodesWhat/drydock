import { createI18n } from 'vue-i18n';

export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

// Vite eager-imports every JSON namespace under locales/<locale>/. New
// translation files are picked up automatically — no edit to this file needed
// when subagents add per-feature namespaces (e.g. locales/en/loginView.json).
const localeModules = import.meta.glob<Record<string, unknown>>('../locales/**/*.json', {
  eager: true,
  import: 'default',
});

export function buildMessages(
  modules: Record<string, Record<string, unknown>> = localeModules,
): Record<SupportedLocale, Record<string, unknown>> {
  const messages: Record<string, Record<string, unknown>> = { en: {} };
  for (const [path, mod] of Object.entries(modules)) {
    const match = path.match(/\/locales\/([^/]+)\//);
    if (!match) continue;
    const locale = match[1];
    if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) continue;
    Object.assign(messages[locale], mod);
  }
  return messages as Record<SupportedLocale, Record<string, unknown>>;
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: buildMessages(),
  missingWarn: false,
  fallbackWarn: false,
});
