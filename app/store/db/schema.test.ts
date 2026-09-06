import { createMigratedMemoryDatabase } from '../../test/sqlite-db.js';
import type { Database } from './driver.js';
import { StoreConstraintError } from './driver.js';
import { INITIAL_SCHEMA_TABLES } from './schema.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function tableNames(db: Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name))
    .sort();
}

function indexNames(db: Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL")
    .all()
    .map((row) => String(row.name));
}

describe('store/db/schema', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('creates every table the store needs, plus its own bookkeeping', () => {
    expect(tableNames(db)).toEqual([...INITIAL_SCHEMA_TABLES, 'schema_migrations'].sort());
  });

  test('declares every table STRICT', () => {
    const lenient = db
      .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND sql IS NOT NULL")
      .all()
      .filter((row) => !String(row.sql).includes('STRICT'))
      .map((row) => String(row.name));
    expect(lenient).toEqual([]);
  });

  test('STRICT turns a type mistake into a write-time error', () => {
    expect(() =>
      db
        .prepare('INSERT INTO name_bindings (agent_name, key_id, last_seen_at) VALUES (?, ?, ?)')
        .run('edge-1', 'abc', 'not-a-number'),
    ).toThrow(StoreConstraintError);
  });

  test('holds the singleton tables to one row', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.8.0');
    expect(() =>
      db
        .prepare('INSERT INTO app_info (id, name, version) VALUES (2, ?, ?)')
        .run('drydock', '1.8.0'),
    ).toThrow(StoreConstraintError);
  });

  test('cascades api key scopes and refuses an orphan scope', () => {
    db.prepare(
      `INSERT INTO api_keys (key_id, schema_version, name, secret_hash, created_at, created_by)
       VALUES (?, 1, ?, ?, ?, ?)`,
    ).run('abc123', 'ci', 'hash', '2026-09-06T00:00:00.000Z', 'user:scott');
    db.prepare('INSERT INTO api_key_scope (key_id, scope) VALUES (?, ?)').run('abc123', 'read');

    expect(() =>
      db.prepare('INSERT INTO api_key_scope (key_id, scope) VALUES (?, ?)').run('nope', 'read'),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }));

    db.prepare('DELETE FROM api_keys WHERE key_id = ?').run('abc123');
    expect(db.prepare('SELECT COUNT(*) AS n FROM api_key_scope').get()).toEqual({ n: 0 });
  });

  test('keeps one approval row per container and candidate', () => {
    const insert = db.prepare(
      `INSERT INTO approvals (
         id, schema_version, container_id, container_identity_key, container_name, watcher,
         image, from_ref, to_ref, candidate_ref, update_kind, semver_diff,
         created_at, created_at_ms, decision
       ) VALUES (?, 1, ?, ?, ?, 'local', 'nginx', '1.0.0', '1.1.0', ?, 'tag', 'minor', ?, ?, 'pending')`,
    );
    insert.run(
      'a1',
      'c1',
      'local::nginx',
      'nginx',
      '1.1.0',
      '2026-09-06T00:00:00.000Z',
      1757116800000,
    );
    expect(() =>
      insert.run(
        'a2',
        'c1',
        'local::nginx',
        'nginx',
        '1.1.0',
        '2026-09-06T00:00:00.000Z',
        1757116800000,
      ),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  });

  test('indexes the four container lookups the Loki collection indexed', () => {
    expect(indexNames(db)).toEqual(
      expect.arrayContaining([
        'containers_identity_key',
        'containers_watcher_status',
        'containers_update_available',
        'containers_name',
      ]),
    );
  });

  test('keeps the update-available index partial', () => {
    const sql = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name = 'containers_update_available'")
      .get();
    expect(String(sql?.sql)).toContain('WHERE update_available = 1');
  });

  test('sorts the audit indexes newest first', () => {
    const rows = db
      .prepare("SELECT name, sql FROM sqlite_schema WHERE name LIKE 'audit_%'")
      .all()
      .map((row) => String(row.sql));
    expect(rows).toHaveLength(2);
    expect(rows.every((sql) => sql.includes('timestamp_ms DESC'))).toBe(true);
  });

  test('stores opaque payloads as plain text columns with no index', () => {
    const indexedColumns = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL")
      .all()
      .map((row) => String(row.sql))
      .join(' ');
    expect(indexedColumns).not.toContain('payload');
    expect(indexedColumns).not.toContain('preferences');
    expect(indexedColumns).not.toContain('update_policy_overrides');
    expect(indexedColumns).not.toContain('container_snapshot');
    expect(indexedColumns).not.toContain('portainer_recovery');
  });
});
