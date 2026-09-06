import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * End-to-end coverage for the roadmap 7-STORE slice 3 first-start import: a
 * real `store.init()` against a real temp directory seeded with a v1.7-era
 * `dd.json`, exercising the actual driver, importers and store modules
 * together rather than the mocked seams `store/index.test.ts` uses.
 */

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;
const FIXTURE_PATH = path.resolve(__dirname, './fixtures/dd-v1.7.json');
const CURRENT_VERSION = '1.8.0';

function setStoreEnv(storePath: string) {
  process.env.DD_STORE_PATH = storePath;
  process.env.DD_STORE_FILE = 'dd.json';
  process.env.DD_VERSION = CURRENT_VERSION;
}

describe('store first-start import from a v1.7 dd.json', () => {
  test('imports app/secrets/settings/ui-preferences and preserves the update mode and the session secret', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-import-'));
    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

    try {
      setStoreEnv(tempDir);
      fs.copyFileSync(FIXTURE_PATH, path.join(tempDir, 'dd.json'));
      vi.resetModules();

      const store = await import('./index.js');
      const app = await import('./app.js');
      const secrets = await import('./secrets.js');
      const settings = await import('./settings.js');
      const uiPreferences = await import('./ui-preferences.js');

      await store.init();

      // app: the imported version drove the upgrade check, then got rewritten
      // to the running version — the same thing `app.ts` already did against
      // LokiJS, now reading and writing the SQLite row instead.
      expect(app.isUpgrade()).toBe(true);
      expect(app.getAppInfos()).toEqual({ name: 'drydock', version: CURRENT_VERSION });

      // settings: an explicitly stored update mode survives the import unchanged.
      expect(settings.getUpdateMode()).toBe('notify');

      // secrets: the session secret survives the import, which is what keeps
      // the login path (app/api/auth.ts, through app/store/secrets.ts) from
      // invalidating every existing session on the upgrade.
      expect(secrets.getStoredSessionSecret()).toBe('v17-session-secret-fixture');

      // ui-preferences: the per-username row survives the import.
      expect(uiPreferences.getPreferences('alice')).toEqual({
        username: 'alice',
        schemaVersion: 11,
        preferences: { theme: 'dark' },
        updatedAt: '2026-01-15T09:00:00.000Z',
      });

      // The untouched pre-1.8 backup is the whole rollback story, and the
      // SQLite database now exists alongside it.
      expect(fs.existsSync(path.join(tempDir, 'dd.json.pre-1.8.bak'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'dd.sqlite'))).toBe(true);

      // A restart against the same directory never re-imports, and the data
      // already landed in dd.sqlite survives it.
      vi.resetModules();
      setStoreEnv(tempDir);
      const restartedStore = await import('./index.js');
      const restartedSecrets = await import('./secrets.js');
      const restartedSettings = await import('./settings.js');

      await restartedStore.init();

      expect(restartedSecrets.getStoredSessionSecret()).toBe('v17-session-secret-fixture');
      expect(restartedSettings.getUpdateMode()).toBe('notify');
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

  test('preserves the "existing installations get auto" update-mode migration through the import', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-import-'));
    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

    try {
      setStoreEnv(tempDir);
      // A store old enough to predate the global update-mode setting: no
      // `updateMode` field on the stored settings document at all.
      const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
      const settingsCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'settings',
      );
      delete settingsCollection.data[0].updateMode;
      fs.writeFileSync(path.join(tempDir, 'dd.json'), JSON.stringify(fixture), 'utf8');
      vi.resetModules();

      const store = await import('./index.js');
      const settings = await import('./settings.js');

      await store.init();

      expect(settings.getUpdateMode()).toBe('auto');
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
