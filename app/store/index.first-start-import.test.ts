import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from './db/driver.js';

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
      const notification = await import('./notification.js');
      const approval = await import('./approval.js');
      const container = await import('./container.js');
      const updateOperation = await import('./update-operation.js');
      const updateLifecycleCache = await import('./update-lifecycle-cache.js');
      const updatePolicyRetentionCache = await import('./update-policy-retention-cache.js');

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
      // older than the retention window). Neither row keeps an explicit
      // timestampMs sibling: both exercise the importer's backfill-from-
      // `timestamp` path end to end, which the assertions below check
      // directly against the SQLite row rather than inferring it from
      // pruning survival alone. The explicit-timestampMs pass-through path
      // is covered separately by store/db/importers/audit.test.ts.
      const auditCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'audit',
      );
      const auditNow = Date.now();
      const auditFirstTimestamp = new Date(auditNow - 60 * 60 * 1000).toISOString();
      const auditSecondTimestamp = new Date(auditNow - 2 * 60 * 60 * 1000).toISOString();
      auditCollection.data[0].data.timestamp = auditFirstTimestamp;
      delete auditCollection.data[0].timestampMs;
      auditCollection.data[1].data.timestamp = auditSecondTimestamp;

      // The decided approval fixture row carries a fixed 2026-01 decidedAt for
      // readability, but approval.createCollections() runs a startup prune of
      // decided rows older than the 30-day retention window (same reasoning
      // as the audit rows above). Move it to "just now" so it survives; the
      // point of the test is the import round trip, not the prune timer.
      const approvalsCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'approvals',
      );
      const decidedApprovalDocument = approvalsCollection.data.find(
        (document: { id: string }) => document.id === 'approval-fixture-decided',
      );
      decidedApprovalDocument.decidedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Both update-operation fixture rows carry fixed 2026-01 timestamps for
      // readability, but updateOperation.createCollections() runs a startup
      // prune of terminal rows older than the 30-day retention window (same
      // reasoning as the audit and approval rows above). Move updatedAt to
      // "just now" for both — pruning keys off updatedAt, falling back to
      // createdAt — so they survive; the point of the test is the import
      // round trip, not the prune timer.
      const updateOperationsCollection = fixture.collections.find(
        (collection: { name: string }) => collection.name === 'updateOperations',
      );
      for (const document of updateOperationsCollection.data) {
        document.data.updatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      }

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

      // Both rows arrived without an explicit timestampMs sibling, so this
      // checks the importer's backfill-from-timestamp path directly against
      // the raw column rather than only inferring it from pruning survival.
      const auditDb = openDatabase(path.join(tempDir, 'dd.sqlite'), { readOnly: true });
      try {
        const firstRow = auditDb
          .prepare('SELECT timestamp_ms FROM audit WHERE id = ?')
          .get('audit-fixture-first');
        const secondRow = auditDb
          .prepare('SELECT timestamp_ms FROM audit WHERE id = ?')
          .get('audit-fixture-second');
        expect(firstRow?.timestamp_ms).toBe(Date.parse(auditFirstTimestamp));
        expect(secondRow?.timestamp_ms).toBe(Date.parse(auditSecondTimestamp));
      } finally {
        auditDb.close();
      }

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

      // backups identity backfill (roadmap 7-STORE slice 10): a legacy row
      // with no recorded identity, whose containerName matches exactly one
      // imported container ('full-app'), is backfilled to that container's
      // identity key — so it is found by identity even though nothing wrote
      // containerIdentityKey pre-migration.
      expect(
        backup
          .getBackupsForContainer({
            containerName: 'full-app',
            containerIdentityKey: 'edge-one::local::full-app',
          })
          .map((entry) => entry.id),
      ).toEqual(['backup-fixture-legacy-resolvable']);
      // A legacy row whose containerName ('shared-svc') matches two imported
      // containers under different watchers is genuinely ambiguous: the
      // import leaves it unowned (NULL identity) rather than guessing.
      const ambiguousBackup = backup
        .getBackupsByName('shared-svc')
        .find((entry) => entry.id === 'backup-fixture-legacy-ambiguous');
      expect(ambiguousBackup?.containerIdentityKey).toBeUndefined();

      // notification rules (roadmap 7-STORE slice 6): the imported rule
      // survives with its trigger allow-list and template overrides intact —
      // both the join-table read path and the normalization pass that runs
      // on every `createCollections()` call.
      expect(notification.getNotificationRule('update-available')).toEqual({
        id: 'update-available',
        name: 'Update Available',
        description: 'When a container has a new version',
        enabled: true,
        bellEnabled: true,
        bellThreshold: 'major',
        triggers: ['slack.ops', 'smtp.ops'],
        templates: {
          'slack.ops': {
            simpleTitle: 'title one',
            simpleBody: 'body one',
            batchTitle: 'batch one',
          },
        },
      });

      // approvals (roadmap 7-STORE slice 6): the imported pending approval
      // reads back as still pending, and the imported decided approval keeps
      // its decision and operation id.
      const pendingApproval = approval.getApprovalById('approval-fixture-pending');
      expect(pendingApproval?.decision).toBe('pending');
      expect(
        approval.listApprovals({ status: 'pending' }).records.map((record) => record.id),
      ).toEqual(['approval-fixture-pending']);
      const decidedApproval = approval.getApprovalById('approval-fixture-decided');
      expect(decidedApproval?.decision).toBe('approved');
      expect(approval.findApprovalByOperationId('operation-one')?.id).toBe(
        'approval-fixture-decided',
      );

      // containers (roadmap 7-STORE slice 8): both fixture rows — a minimal
      // one and one with a full image/result/security/policy shape — import
      // and read back through the public container functions, and the list
      // renders the same shape the API returns.
      const minimalContainer = container.getContainer('container-cache-web');
      expect(minimalContainer).toMatchObject({
        id: 'container-cache-web',
        name: 'cache-web',
        watcher: 'local',
      });
      expect(minimalContainer?.image.name).toBe('library/web');
      expect(minimalContainer?.image.tag.value).toBe('one');
      const fullContainer = container.getContainer('container-full-app');
      expect(fullContainer).toMatchObject({
        id: 'container-full-app',
        name: 'full-app',
        displayName: 'Full App',
        status: 'running',
        health: 'healthy',
        watcher: 'local',
        agent: 'edge-one',
        sourceRepo: 'library/full-app-source',
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 3 },
      });
      expect(fullContainer?.security?.scan?.summary).toEqual({
        unknown: 0,
        low: 1,
        medium: 0,
        high: 0,
        critical: 0,
      });
      expect(
        container
          .getContainers()
          .map((entry) => entry.id)
          .sort(),
      ).toEqual([
        'container-cache-web',
        'container-full-app',
        'container-shared-svc-a',
        'container-shared-svc-b',
      ]);

      // update operations (roadmap 7-STORE slice 10): the terminal fixture row's
      // container_identity_key round-trips through the import, derived from its
      // container snapshot exactly the way a fresh insertOperation() would; the
      // orphaned row (no agent/watcher/container snapshot) imports with no
      // identity rather than a guessed one.
      const importedSucceeded = updateOperation.getOperationById('operation-fixture-succeeded');
      expect(importedSucceeded).toMatchObject({
        containerName: 'full-app',
        status: 'succeeded',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        containerIdentityKey: 'edge-one::local::full-app',
      });
      const importedOrphan = updateOperation.getOperationById('operation-fixture-orphan');
      expect(importedOrphan).toMatchObject({
        containerName: 'ghost-worker',
        status: 'failed',
      });
      expect(importedOrphan?.containerIdentityKey).toBeUndefined();

      // update-lifecycle cache (roadmap 7-STORE slice 7): the fixture's legacy
      // `watcher::name` row maps forward to the still-present container's
      // identity key, and the orphaned row (no matching container in the
      // imported data) is dropped rather than guessed at.
      const lifecycleCacheRecords = updateLifecycleCache.listRecords();
      expect(lifecycleCacheRecords).toEqual([
        expect.objectContaining({
          cacheKey: '::local::cache-web',
          updateDetectedAt: '2026-01-05T00:00:00.000Z',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);

      // update-policy-retention cache (roadmap 7-STORE slice 7): already keyed
      // on identity before the migration, so it imports unchanged.
      expect(updatePolicyRetentionCache.listRecords()).toEqual([
        expect.objectContaining({
          cacheKey: '::local::cache-web',
          updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
        }),
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
