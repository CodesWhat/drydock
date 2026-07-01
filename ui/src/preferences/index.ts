export const PREFERENCES_API_VERSION = 1;

export { mergeDefaults, migrate, migrateFromLegacyKeys } from './migrate';
export { DEFAULTS } from './schema';
export { flushPreferences, preferences, resetPreferences } from './store';
export { usePreference } from './usePreference';
export { isValidLocale, isValidScale } from './validators';
