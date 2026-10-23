import fs from 'node:fs';
import path from 'node:path';
import { createTemporaryStoreDirectory } from '../../test/sqlite-db.js';
import { type Database, openDatabase } from './driver.js';
import { MIGRATIONS, migrate, StoreSchemaTooNewError } from './migrations.js';
import {
  PRE_MIGRATION_SNAPSHOT_RETENTION,
  prepareDatabaseForMigration,
  StoreSnapshotError,
} from './pre-migration.js';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => logMock },
}));

describe('store/db/pre-migration', () => {
  let directory: string;
  let databasePath: string;
  let db: Database | undefined;

  const olderMigrations = MIGRATIONS.slice(0, -1);
  const olderVersion = olderMigrations.at(-1)?.version;

  function snapshotNames(): string[] {
    return fs
      .readdirSync(directory)
      .filter((name) => name.includes('.pre-migration-'))
      .sort();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    directory = createTemporaryStoreDirectory();
    databasePath = path.join(directory, 'dd.sqlite');
    db = openDatabase(databasePath);
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('skips the snapshot on a fresh database', () => {
    expect(prepareDatabaseForMigration(db as Database, databasePath)).toBeUndefined();
    expect(snapshotNames()).toEqual([]);
  });

  test('skips the snapshot when nothing is pending', () => {
    migrate(db as Database);
    expect(prepareDatabaseForMigration(db as Database, databasePath)).toBeUndefined();
    expect(snapshotNames()).toEqual([]);
  });

  test('writes a consistent, restorable snapshot of the pre-migration state', () => {
    migrate(db as Database, olderMigrations);
    (db as Database)
      .prepare('INSERT INTO agent_keys (key_id, pubkey, label, created_at) VALUES (?, ?, ?, ?)')
      .run('k1', 'pub', 'agent', 'created');

    const snapshotPath = prepareDatabaseForMigration(db as Database, databasePath, {
      now: () => new Date('2026-10-22T15:30:45.123Z'),
    }) as string;

    expect(snapshotPath).toBe(`${databasePath}.pre-migration-v${olderVersion}-20261022T153045123Z`);
    expect(fs.statSync(snapshotPath).mode & 0o777).toBe(0o600);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining(snapshotPath));

    migrate(db as Database);
    const restored = openDatabase(snapshotPath, { readOnly: true });
    try {
      expect(restored.prepare('SELECT key_id FROM agent_keys').all()).toEqual([{ key_id: 'k1' }]);
      expect(
        restored.prepare('SELECT MAX(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: olderVersion });
    } finally {
      restored.close();
    }
  });

  test('handles a database path containing a single quote', () => {
    const quotedPath = path.join(directory, "it's.sqlite");
    const quoted = openDatabase(quotedPath);
    try {
      migrate(quoted, olderMigrations);
      const snapshotPath = prepareDatabaseForMigration(quoted, quotedPath) as string;
      expect(fs.existsSync(snapshotPath)).toBe(true);
    } finally {
      quoted.close();
    }
  });

  test('keeps only the newest snapshots and never touches unrelated files', () => {
    migrate(db as Database, olderMigrations);
    const stamps = [
      '20260101T000000000Z',
      '20260102T000000000Z',
      '20260103T000000000Z',
      '20260104T000000000Z',
    ];
    for (const stamp of stamps) {
      fs.writeFileSync(`${databasePath}.pre-migration-v1-${stamp}`, 'old');
    }
    fs.writeFileSync(`${databasePath}.pre-migration-notes`, 'keep');
    fs.writeFileSync(
      path.join(directory, 'other.sqlite.pre-migration-v1-20200101T000000000Z'),
      'keep',
    );

    const snapshotPath = prepareDatabaseForMigration(db as Database, databasePath, {
      now: () => new Date('2026-10-22T00:00:00.000Z'),
    }) as string;

    const kept = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith('dd.sqlite.pre-migration-v'))
      .sort();
    expect(kept).toHaveLength(PRE_MIGRATION_SNAPSHOT_RETENTION);
    expect(kept).toContain(path.basename(snapshotPath));
    expect(kept).toContain('dd.sqlite.pre-migration-v1-20260104T000000000Z');
    expect(kept).not.toContain('dd.sqlite.pre-migration-v1-20260101T000000000Z');
    expect(fs.existsSync(`${databasePath}.pre-migration-notes`)).toBe(true);
    expect(
      fs.existsSync(path.join(directory, 'other.sqlite.pre-migration-v1-20200101T000000000Z')),
    ).toBe(true);
  });

  test('honors a custom retention count', () => {
    migrate(db as Database, olderMigrations);
    fs.writeFileSync(`${databasePath}.pre-migration-v1-20260101T000000000Z`, 'old');
    prepareDatabaseForMigration(db as Database, databasePath, { retain: 1 });
    expect(snapshotNames()).toHaveLength(1);
    expect(snapshotNames()[0]).not.toContain('20260101');
  });

  test('warns and carries on when an old snapshot cannot be deleted', () => {
    migrate(db as Database, olderMigrations);
    fs.mkdirSync(`${databasePath}.pre-migration-v1-20260101T000000000Z`);
    fs.writeFileSync(path.join(`${databasePath}.pre-migration-v1-20260101T000000000Z`, 'x'), 'x');

    expect(prepareDatabaseForMigration(db as Database, databasePath, { retain: 1 })).toBeDefined();
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not delete old store snapshot'),
    );
  });

  test('fails with a clear error and no partial file when the snapshot cannot be written', () => {
    migrate(db as Database, olderMigrations);
    const missingDirectoryPath = path.join(directory, 'missing', 'dd.sqlite');

    expect(() => prepareDatabaseForMigration(db as Database, missingDirectoryPath)).toThrow(
      StoreSnapshotError,
    );
    expect(() => prepareDatabaseForMigration(db as Database, missingDirectoryPath)).toThrow(
      /Refusing to migrate the store without a restore point/,
    );
    expect(snapshotNames()).toEqual([]);
  });

  test('describes a non-Error snapshot failure', () => {
    expect(new StoreSnapshotError('/x', 'disk on fire').message).toContain('disk on fire');
  });

  test('refuses a database from a newer build before snapshotting', () => {
    migrate(db as Database);
    (db as Database)
      .prepare(
        "INSERT INTO schema_migrations (version, applied_at, note) VALUES (?, 'now', 'future')",
      )
      .run(9999);

    expect(() => prepareDatabaseForMigration(db as Database, databasePath)).toThrow(
      StoreSchemaTooNewError,
    );
    expect(snapshotNames()).toEqual([]);
  });
});
