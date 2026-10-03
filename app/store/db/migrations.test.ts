import { createMemoryDatabase } from '../../test/sqlite-db.js';
import type { Database } from './driver.js';
import {
  getAppliedSchemaVersions,
  MIGRATIONS,
  migrate,
  TOTP_MIGRATION_VERSION,
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
    expect(migrate(db)).toEqual([TOTP_MIGRATION_VERSION]);
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
});
