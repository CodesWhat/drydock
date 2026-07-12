import { createCollections, type getSettings, updateSettings } from './settings.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectNotAny<T> = IsAny<T> extends true ? false : true;

const createCollectionsDbIsTyped: ExpectNotAny<Parameters<typeof createCollections>[0]> = true;
const internetlessModeIsTyped: ExpectNotAny<ReturnType<typeof getSettings>['internetlessMode']> =
  true;
const updateModeIsTyped: ExpectNotAny<ReturnType<typeof getSettings>['updateMode']> = true;

updateSettings({ internetlessMode: true });
updateSettings({ updateMode: 'notify' });

// @ts-expect-error internetlessMode should be boolean
updateSettings({ internetlessMode: 'yes' });

// @ts-expect-error updateMode should be a supported mode
updateSettings({ updateMode: 'sometimes' });

// @ts-expect-error createCollections requires db collection methods
createCollections({});

void createCollectionsDbIsTyped;
void internetlessModeIsTyped;
void updateModeIsTyped;
