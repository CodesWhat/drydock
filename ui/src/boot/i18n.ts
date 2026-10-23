import { createI18n } from 'vue-i18n';
import {
  DEFAULT_LOCALE,
  LOCALE_OPTIONS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../i18n/locales';

export type { SupportedLocale };
export { LOCALE_OPTIONS, SUPPORTED_LOCALES };

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
  const messages: Record<string, Record<string, unknown>> = Object.fromEntries(
    SUPPORTED_LOCALES.map((l) => [l, {}]),
  );
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

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function getLocaleDirection(locale: string): 'rtl' | 'ltr' {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getTextInfo?: () => { direction: string };
      textInfo?: { direction: string };
    };
    const direction = (info.getTextInfo?.() ?? info.textInfo)?.direction;
    if (direction === 'rtl' || direction === 'ltr') return direction;
  } catch {
    // fall through to the static list
  }
  return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

export function setI18nLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = getLocaleDirection(locale);
  }
}
