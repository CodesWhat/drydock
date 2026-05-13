export const SUPPORTED_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'it',
  'es',
  'de',
  'fr',
  'pt-BR',
  'nl',
  'pl',
  'tr',
  'ja',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export interface LocaleOption {
  id: SupportedLocale;
  label: string;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'it', label: 'Italiano' },
  { id: 'es', label: 'Español' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'nl', label: 'Nederlands' },
  { id: 'pl', label: 'Polski' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'ja', label: '日本語' },
];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
