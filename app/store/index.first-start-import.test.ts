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
      vi.resetModules();

      const store = await import('./index.js');
      const app = await import('./app.js');
      const secrets = await import('./secrets.js');
      const settings = await import('./settings.js');
      const uiPreferences = await import('./ui-preferences.js');
      const agentKeys = await import('./agent-keys.js');
      const nameBindings = await import('./name-bindings.js');
      const apiKey = await import('./api-key.js');
      const audit = await import('./audit.js');
      const backup = await import('./backup.js');
      const notificationOutbox = await import('./notification-outbox.js');

      // The fixture stores a placeholder secretHash for its api-keys rows
      // (a real hash is a high-entropy string gitleaks flags as an API key
      // in every commit that ever touches it); patch in a real hash for a
      // low-entropy plaintext secret right before the import runs, the same
      // way a real v1.7 install would have a real hash on disk.
      const v17Secret = 'a'.repeat(43);
      const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
      const apiKeysCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'api-keys',
      );
      apiKeysCollection.data[0].secretHash = apiKey.hashApiKeySecret(v17Secret);

      // The audit fixture rows carry fixed 2026-01 timestamps for
      // readability, but `audit.createCollections()` prunes anything older
      // than the 30-day retention window the moment `store.init()` wires it
      // up. Move both rows to "just now" so they survive that prune — the
      // point of the test is the import's timestampMs backfill, not the
      // prune timer, and a row that had NOT been backfilled would still be
      // pruned here (an unfilled timestamp_ms falls back to 0, which is far
      // older than the retention window).
      const auditCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'audit',
      );
      const auditNow = Date.now();
      const auditFirstTimestamp = new Date(auditNow - 60 * 60 * 1000).toISOString();
      const auditSecondTimestamp = new Date(auditNow - 2 * 60 * 60 * 1000).toISOString();
      auditCollection.data[0].data.timestamp = auditFirstTimestamp;
      auditCollection.data[0].timestampMs = Date.parse(auditFirstTimestamp);
      auditCollection.data[1].data.timestamp = auditSecondTimestamp;

      fs.writeFileSync(path.join(tempDir, 'dd.json'), JSON.stringify(fixture), 'utf8');

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

      // agent-keys (roadmap 7-STORE slice 4): the imported key is returned by
      // both getKey and listKeys.
      expect(agentKeys.getKey('aabbccddeeff0011')).toEqual({
        keyId: 'aabbccddeeff0011',
        pubkey: 'ZInSz0Dj5w/lTBfVbfUds8CfETZrM0mrpWUdWSLtJZc=',
        label: 'edge-node-1',
        createdAt: '2026-01-10T00:00:00.000Z',
        revokedAt: null,
      });
      expect(agentKeys.listKeys().map((key) => key.keyId)).toEqual(['aabbccddeeff0011']);

      // name-bindings: deleteBindingsForKey releases the same name the fixture
      // bound to the imported agent key.
      expect(nameBindings.deleteBindingsForKey('aabbccddeeff0011')).toEqual(['edge-node-1']);

      // api-keys: a ddk_ credential minted under v1.7 still verifies after the
      // import, with its scopes carried across via the api_key_scope join
      // table in the same order they were created in.
      const verified = apiKey.verifyApiKey(`ddk_aaaaaaaaaaaa_${v17Secret}`);
      expect(verified?.keyId).toBe('aaaaaaaaaaaa');
      expect(verified?.scopes).toEqual(['read', 'write']);
      // The minted child key's parent link survived the import too.
      expect(apiKey.findApiKeyById('bbbbbbbbbbbb')?.parentKeyId).toBe('aaaaaaaaaaaa');

      // audit (roadmap 7-STORE slice 5): both fixture rows survive the
      // retention prune above, newest first — proving the importer
      // backfilled timestamp_ms for the row that arrived without one.
      const auditPage = audit.getAuditEntries();
      expect(auditPage.total).toBe(2);
      expect(auditPage.entries.map((entry) => entry.containerName)).toEqual(['web', 'app']);

      // notification outbox (roadmap 7-STORE slice 5): the pending fixture
      // entry is ready for delivery (its nextAttemptAt is in the past); the
      // dead-letter entry is excluded from the ready-for-delivery scan.
      const readyOutboxEntries = notificationOutbox.findReadyForDelivery();
      expect(readyOutboxEntries.map((entry) => entry.id)).toEqual(['outbox-fixture-pending']);

      // backups (roadmap 7-STORE slice 5): the by-name reader still finds
      // the imported backup, keyed on container name as it was pre-import.
      expect(backup.getBackupsByName('web')).toEqual([
        expect.objectContaining({ id: 'backup-fixture-one', containerName: 'web' }),
      ]);

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
