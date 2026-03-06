import { createCollections } from './notification.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectNotAny<T> = IsAny<T> extends true ? false : true;

const createCollectionsDbIsTyped: ExpectNotAny<Parameters<typeof createCollections>[0]> = true;

// @ts-expect-error createCollections requires db collection methods
createCollections({});

void createCollectionsDbIsTyped;
