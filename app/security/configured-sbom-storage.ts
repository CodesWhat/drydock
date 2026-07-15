import { resolveConfiguredPath } from '../runtime/paths.js';
import { getConfiguration as getValidatedStoreConfiguration } from '../store/index.js';
import { createSbomStorage } from './sbom-storage.js';

export function createConfiguredSbomStorage() {
  return createSbomStorage({
    rootDir: resolveConfiguredPath(getValidatedStoreConfiguration().path, {
      label: 'DD_STORE_PATH',
    }),
  });
}
