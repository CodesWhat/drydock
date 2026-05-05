export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'it', 'es', 'de', 'fr', 'pt-BR'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export interface LocaleOption {
  id: SupportedLocale;
  label: string;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'it', label: 'Italiano' },
  { id: 'es', label: 'Español' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
