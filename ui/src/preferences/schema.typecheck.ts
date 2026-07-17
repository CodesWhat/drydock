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

const invalidContainerViewMode: PreferencesSchema = {
  ...DEFAULTS,
  containers: {
    ...DEFAULTS.containers,
    // @ts-expect-error 'list' is not a valid ViewMode — the 3-way mode is gone for good
    viewMode: 'list',
  },
};

void invalidContainerViewMode;
