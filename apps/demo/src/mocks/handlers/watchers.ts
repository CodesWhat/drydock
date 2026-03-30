import { watchers } from '../data/watchers';
import { createTypeNameHandlers } from './typeNameHandlers';

export const watcherHandlers = createTypeNameHandlers('/api/v1/watchers', watchers);
