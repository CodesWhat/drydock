import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContainerFixture } from '../test/helpers.js';

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;

function setStoreEnv(storePath: string) {
  process.env.DD_STORE_PATH = storePath;
  process.env.DD_STORE_FILE = 'dd.json';
  process.env.DD_VERSION = '1.5.0';
}

describe('store startup repair integration', () => {
  test('init should backfill missing tagPrecision for persisted containers after restart', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-'));
    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

    try {
      setStoreEnv(tempDir);
      vi.resetModules();

      const store = await import('./index.js');
      const storeContainer = await import('./container.js');

      await store.init();
      storeContainer.insertContainer(
        createContainerFixture({
          id: 'startup-repair-specific',
          image: {
            id: 'image-startup-repair-specific',
            registry: {
              name: 'registry',
              url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
              value: '1.2.3',
              semver: true,
            },
            digest: {
              watch: false,
              repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
          },
          result: {
            tag: '1.2.3',
          },
        }),
      );
      await store.save();

      setStoreEnv(tempDir);
      vi.resetModules();

      const restartedStore = await import('./index.js');
      const restartedContainer = await import('./container.js');

      await restartedStore.init();

      expect(restartedContainer.getContainerRaw('startup-repair-specific')?.image.tag).toEqual(
        expect.objectContaining({
          value: '1.2.3',
          tagPrecision: 'specific',
        }),
      );
    } finally {
      ENV_KEYS.forEach((key) => {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
