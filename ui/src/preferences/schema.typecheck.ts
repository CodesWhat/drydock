import { DEFAULTS, type PreferencesSchema } from './schema';

const invalidThemeFamily: PreferencesSchema = {
  ...DEFAULTS,
  theme: {
    ...DEFAULTS.theme,
    // @ts-expect-error invalid theme family should be rejected
    family: 'invalid-theme',
  },
};

void invalidThemeFamily;
