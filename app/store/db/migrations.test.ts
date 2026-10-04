import { createMemoryDatabase } from '../../test/sqlite-db.js';
import type { Database } from './driver.js';
import { StoreConstraintError } from './driver.js';
import {
  GROUP_POLICIES_MIGRATION_VERSION,
  getAppliedSchemaVersions,
  LABEL_OVERRIDES_MIGRATION_VERSION,
  MIGRATIONS,
  migrate,
  TOTP_MIGRATION_VERSION,
  TOTP_SUBJECT_USERNAME_MIGRATION_VERSION,
} from './migrations.js';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => logMock },
}));

describe('store/db/migrations', () => {
  let db: Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('applies every shipped migration on a fresh database', () => {
    expect(migrate(db)).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(getAppliedSchemaVersions(db)).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('initial schema'));
  });

  test('is idempotent: a second run applies nothing', () => {
    migrate(db);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
      n: MIGRATIONS.length,
    });
  });

  test('applies the TOTP tables as version 10 even when 7 to 9 are not present yet', () => {
    expect(TOTP_MIGRATION_VERSION).toBe(10);
    const withGap = MIGRATIONS.filter(
      (migration) => migration.version < 7 || migration.version === TOTP_MIGRATION_VERSION,
    );
    expect(migrate(db, withGap)).toEqual([1, 2, 3, 4, 5, 6, TOTP_MIGRATION_VERSION]);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'totp_factors'").all(),
    ).toHaveLength(1);
  });

  test('a database migrated before TOTP existed picks the tables up later', () => {
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version < TOTP_MIGRATION_VERSION),
    );
    expect(migrate(db)).toEqual([TOTP_MIGRATION_VERSION, TOTP_SUBJECT_USERNAME_MIGRATION_VERSION]);
  });

  test('migration 11 adds the username column and backfills it from existing factors', () => {
    expect(TOTP_SUBJECT_USERNAME_MIGRATION_VERSION).toBe(11);
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version < TOTP_SUBJECT_USERNAME_MIGRATION_VERSION),
    );
    db.prepare(
      `INSERT INTO totp_factors (factor_id, schema_version, subject_id, provider_id, username,
         factor_version, encryption_key_id, secret_nonce, secret_ciphertext, secret_auth_tag,
         algorithm, digits, period_seconds, allowed_skew_steps, created_at, activated_at,
         updated_at, last_accepted_counter, recovery_generation)
       VALUES ('f', 1, 'with-factor', 'basic.one', 'scott', 1, 'k1', 'n', 'c', 'a',
         'SHA1', 6, 30, 1, 't', 't', 't', 1, 1)`,
    ).run();
    db.prepare('INSERT INTO totp_subject_versions (subject_id, factor_version) VALUES (?, ?)').run(
      'with-factor',
      1,
    );
    db.prepare('INSERT INTO totp_subject_versions (subject_id, factor_version) VALUES (?, ?)').run(
      'removed',
      2,
    );

    expect(migrate(db)).toEqual([TOTP_SUBJECT_USERNAME_MIGRATION_VERSION]);

    const rows = db
      .prepare('SELECT subject_id, username FROM totp_subject_versions ORDER BY subject_id')
      .all();
    expect(rows).toEqual([
      { subject_id: 'removed', username: null },
      { subject_id: 'with-factor', username: 'scott' },
    ]);
    expect(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'totp_subject_versions_username'")
        .all(),
    ).toHaveLength(1);
  });

  test('records the version, the note and when it was applied', () => {
    migrate(db);
    const row = db.prepare('SELECT version, note, applied_at FROM schema_migrations').get();
    expect(row).toMatchObject({ version: 1, note: 'initial schema' });
    expect(String(row?.applied_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('reads an empty applied set before anything has run', () => {
    expect(getAppliedSchemaVersions(db)).toEqual([]);
  });

  test('applies pending migrations in version order regardless of list order', () => {
    migrate(db, [
      { version: 20, note: 'second', sql: 'CREATE TABLE later (id INTEGER PRIMARY KEY) STRICT;' },
      { version: 10, note: 'first', sql: 'CREATE TABLE earlier (id INTEGER PRIMARY KEY) STRICT;' },
    ]);
    expect(getAppliedSchemaVersions(db)).toEqual([10, 20]);
  });

  test('applies only the versions that are missing', () => {
    migrate(db, [
      { version: 1, note: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
    ]);
    expect(
      migrate(db, [
        { version: 1, note: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
        { version: 2, note: 'two', sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;' },
      ]),
    ).toEqual([2]);
  });

  test('leaves the schema and the bookkeeping consistent when a migration throws', () => {
    expect(() =>
      migrate(db, [
        { version: 1, note: 'ok', sql: 'CREATE TABLE ok (id INTEGER PRIMARY KEY) STRICT;' },
        { version: 2, note: 'broken', sql: 'CREATE TABLE ; ;' },
      ]),
    ).toThrow();
    expect(getAppliedSchemaVersions(db)).toEqual([]);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'ok'")
        .get(),
    ).toEqual({ n: 0 });
  });

  describe('group policies migration', () => {
    const insertPolicy = (database: Database, id: string, group: string, revision = 1) =>
      database
        .prepare(
          `INSERT INTO group_policies
             (id, group_name, revision, update_policy, actions, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, '{}', '{}', 'now', 'user:admin', 'now', 'user:admin')`,
        )
        .run(id, group, revision);

    test('is appended after every earlier version and applies exactly once', () => {
      const versions = MIGRATIONS.map((migration) => migration.version);
      expect(versions.filter((version) => version > GROUP_POLICIES_MIGRATION_VERSION)).toEqual([
        LABEL_OVERRIDES_MIGRATION_VERSION,
        TOTP_MIGRATION_VERSION,
        TOTP_SUBJECT_USERNAME_MIGRATION_VERSION,
      ]);
      expect(migrate(db)).toContain(GROUP_POLICIES_MIGRATION_VERSION);
      expect(migrate(db)).toEqual([]);
      expect(
        db
          .prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = ?')
          .get(GROUP_POLICIES_MIGRATION_VERSION),
      ).toEqual({ n: 1 });
    });

    test('creates a STRICT group_policies table keyed by an exact-case unique group name', () => {
      migrate(db);
      const tableSql = String(
        db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'group_policies'").get()?.sql,
      );
      expect(tableSql).toContain('STRICT');

      insertPolicy(db, 'policy-lower', 'payments');
      insertPolicy(db, 'policy-upper', 'Payments');
      insertPolicy(db, 'policy-padded', ' payments ');
      expect(() => insertPolicy(db, 'policy-duplicate', 'payments')).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
      );
      expect(
        db
          .prepare('SELECT group_name FROM group_policies ORDER BY id')
          .all()
          .map((row) => row.group_name),
      ).toEqual(['payments', ' payments ', 'Payments']);
    });

    test('rejects a revision below 1 and a body of the wrong type', () => {
      migrate(db);
      expect(() => insertPolicy(db, 'policy-zero', 'payments', 0)).toThrow(StoreConstraintError);
      expect(() =>
        db
          .prepare(
            `INSERT INTO group_policies
               (id, group_name, revision, update_policy, actions, created_at, created_by, updated_at, updated_by)
             VALUES ('policy-typed', 'payments', 'one', '{}', '{}', 'now', 'u', 'now', 'u')`,
          )
          .run(),
      ).toThrow(StoreConstraintError);
    });

    test('adds a nullable containers.group_policy column to an existing database in place', () => {
      migrate(
        db,
        MIGRATIONS.filter((migration) => migration.version < GROUP_POLICIES_MIGRATION_VERSION),
      );
      db.prepare(
        `INSERT INTO containers (id, identity_key, name, display_name, status, watcher, image_name, image_tag_value, image)
         VALUES ('existing', '::local::existing', 'existing', 'existing', 'running', 'local', 'library/web', '1', '{}')`,
      ).run();

      expect(migrate(db)).toEqual([
        GROUP_POLICIES_MIGRATION_VERSION,
        LABEL_OVERRIDES_MIGRATION_VERSION,
        TOTP_MIGRATION_VERSION,
        TOTP_SUBJECT_USERNAME_MIGRATION_VERSION,
      ]);
      expect(db.prepare("SELECT group_policy FROM containers WHERE id = 'existing'").get()).toEqual(
        { group_policy: null },
      );
    });
  });
  describe('label overrides migration', () => {
    const insertOverride = (
      database: Database,
      id: string,
      scopeKey: string,
      overrides: { kind?: string; revision?: number } = {},
    ) =>
      database
        .prepare(
          `INSERT INTO container_label_overrides
             (id, scope_key, agent, watcher, scope_kind, scope_name, fields, revision, created_at, updated_at)
           VALUES (?, ?, '', 'local', ?, 'web', '{}', ?, 'now', 'now')`,
        )
        .run(id, scopeKey, overrides.kind ?? 'container', overrides.revision ?? 1);

    test('is appended after the group policies migration and applies exactly once', () => {
      expect(
        MIGRATIONS.find((migration) => migration.version > GROUP_POLICIES_MIGRATION_VERSION)
          ?.version,
      ).toBe(LABEL_OVERRIDES_MIGRATION_VERSION);
      expect(LABEL_OVERRIDES_MIGRATION_VERSION).toBe(GROUP_POLICIES_MIGRATION_VERSION + 1);
      expect(migrate(db)).toContain(LABEL_OVERRIDES_MIGRATION_VERSION);
      expect(migrate(db)).toEqual([]);
    });

    test('creates a STRICT table with a unique scope key, a scope kind and a revision floor', () => {
      migrate(db);
      expect(
        String(
          db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'container_label_overrides'").get()
            ?.sql,
        ),
      ).toContain('STRICT');
      insertOverride(db, 'one', '::local::web');
      expect(() => insertOverride(db, 'two', '::local::web')).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
      );
      expect(() => insertOverride(db, 'three', '::local::api', { kind: 'pod' })).toThrow(
        StoreConstraintError,
      );
      expect(() => insertOverride(db, 'four', '::local::api', { revision: 0 })).toThrow(
        StoreConstraintError,
      );
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name = 'container_label_overrides_watcher_agent'",
          )
          .get(),
      ).toEqual({ name: 'container_label_overrides_watcher_agent' });
    });

    test('adds a nullable containers.label_owned column to an existing database in place', () => {
      migrate(
        db,
        MIGRATIONS.filter((migration) => migration.version < LABEL_OVERRIDES_MIGRATION_VERSION),
      );
      db.prepare(
        `INSERT INTO containers (id, identity_key, name, display_name, status, watcher, image_name, image_tag_value, image)
         VALUES ('existing', '::local::existing', 'existing', 'existing', 'running', 'local', 'library/web', '1', '{}')`,
      ).run();

      expect(migrate(db)).toEqual([
        LABEL_OVERRIDES_MIGRATION_VERSION,
        TOTP_MIGRATION_VERSION,
        TOTP_SUBJECT_USERNAME_MIGRATION_VERSION,
      ]);
      expect(db.prepare("SELECT label_owned FROM containers WHERE id = 'existing'").get()).toEqual({
        label_owned: null,
      });
    });
  });
});
