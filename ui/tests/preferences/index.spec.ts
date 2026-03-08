import * as preferencesModule from '@/preferences';
import { DEFAULTS } from '@/preferences/schema';

describe('preferences index exports', () => {
  it('re-exports the main preferences API', () => {
    expect(preferencesModule.PREFERENCES_API_VERSION).toBe(1);
    expect(preferencesModule.DEFAULTS).toBe(DEFAULTS);
    expect(typeof preferencesModule.migrate).toBe('function');
    expect(typeof preferencesModule.mergeDefaults).toBe('function');
    expect(typeof preferencesModule.migrateFromLegacyKeys).toBe('function');
    expect(typeof preferencesModule.flushPreferences).toBe('function');
    expect(typeof preferencesModule.resetPreferences).toBe('function');
    expect(preferencesModule.preferences).toBeDefined();
    expect(typeof preferencesModule.usePreference).toBe('function');
    expect(typeof preferencesModule.useViewMode).toBe('function');
    expect(typeof preferencesModule.isViewMode).toBe('function');
    expect(typeof preferencesModule.isValidScale).toBe('function');
  });
});
