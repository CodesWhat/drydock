import { registries } from '../data/registries';
import { createTypeNameHandlers } from './typeNameHandlers';

export const registryHandlers = createTypeNameHandlers('/api/registries', registries);
