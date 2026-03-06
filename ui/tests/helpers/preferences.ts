import { deepMerge } from '@/preferences/deepMerge';
import type { PreferencesSchema } from '@/preferences/schema';
import { DEFAULTS } from '@/preferences/schema';

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };

export function setTestPreferences(overrides: DeepPartial<PreferencesSchema>): void {
  localStorage.setItem(
    'dd-preferences',
    JSON.stringify(deepMerge(structuredClone(DEFAULTS), overrides as Record<string, unknown>)),
  );
}
