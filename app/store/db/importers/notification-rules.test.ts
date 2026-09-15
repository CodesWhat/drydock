import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { notificationRulesImporter } from './notification-rules.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'notifications', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/notification-rules', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return notificationRulesImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(notificationRulesImporter);
    expect(notificationRulesImporter.collection).toBe('notifications');
    expect(notificationRulesImporter.table).toBe('notification_rules');
  });

  test('carries a fully-formed rule across field for field, with triggers and templates joined in', () => {
    expect(
      run([
        {
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
        },
      ]),
    ).toBe(1);

    expect(
      db
        .prepare(
          'SELECT id, name, description, enabled, bell_enabled, bell_threshold FROM notification_rules',
        )
        .get(),
    ).toEqual({
      id: 'update-available',
      name: 'Update Available',
      description: 'When a container has a new version',
      enabled: 1,
      bell_enabled: 1,
      bell_threshold: 'major',
    });
    expect(
      db
        .prepare(
          'SELECT trigger_id FROM notification_rule_trigger WHERE rule_id = ? ORDER BY ordinal',
        )
        .all('update-available'),
    ).toEqual([{ trigger_id: 'slack.ops' }, { trigger_id: 'smtp.ops' }]);
    // No ORDER BY on this query: the composite primary key on
    // (rule_id, trigger_id, field) can make SQLite satisfy it via the index
    // rather than insertion order, so this compares as a set, not a sequence.
    expect(
      db
        .prepare(
          'SELECT trigger_id, field, value FROM notification_rule_template WHERE rule_id = ? ORDER BY field',
        )
        .all('update-available'),
    ).toEqual([
      { trigger_id: 'slack.ops', field: 'batchTitle', value: 'batch one' },
      { trigger_id: 'slack.ops', field: 'simpleBody', value: 'body one' },
      { trigger_id: 'slack.ops', field: 'simpleTitle', value: 'title one' },
    ]);
  });

  test('dedupes a legacy trigger list so the join table primary key is never violated', () => {
    expect(
      run([
        {
          id: 'update-applied',
          triggers: ['smtp.ops', 'smtp.ops', '', 'slack.ops'],
        },
      ]),
    ).toBe(1);

    expect(
      db
        .prepare(
          'SELECT trigger_id FROM notification_rule_trigger WHERE rule_id = ? ORDER BY ordinal',
        )
        .all('update-applied'),
    ).toEqual([{ trigger_id: 'smtp.ops' }, { trigger_id: 'slack.ops' }]);
  });

  test('falls back to the catalog default for a known id missing a scalar field', () => {
    expect(run([{ id: 'agent-disconnect' }])).toBe(1);

    const row = db
      .prepare(
        'SELECT name, description, enabled, bell_enabled, bell_threshold FROM notification_rules',
      )
      .get();
    expect(row).toEqual({
      name: 'Agent Disconnected',
      description: 'When a remote agent loses connection',
      enabled: 0,
      bell_enabled: 1,
      bell_threshold: 'all',
    });
  });

  test('falls back to schema defaults for an unknown (custom) id missing scalar fields', () => {
    expect(run([{ id: 'my-custom-rule' }])).toBe(1);

    const row = db
      .prepare(
        'SELECT name, description, enabled, bell_enabled, bell_threshold FROM notification_rules',
      )
      .get();
    expect(row).toEqual({
      name: 'my-custom-rule',
      description: '',
      enabled: 1,
      bell_enabled: 0,
      bell_threshold: 'all',
    });
  });

  test('lower-cases the id and ignores an invalid bellThreshold', () => {
    expect(run([{ id: 'MY-Rule', bellThreshold: 'not-a-threshold' }])).toBe(1);

    expect(db.prepare('SELECT id, bell_threshold FROM notification_rules').get()).toEqual({
      id: 'my-rule',
      bell_threshold: 'all',
    });
  });

  test('ignores template entries with an unknown field name or a non-string value', () => {
    expect(
      run([
        {
          id: 'update-available',
          templates: {
            'slack.ops': { simpleTitle: 'ok', unknownField: 'nope', simpleBody: 5 },
            'bad-trigger': 'not-an-object',
          },
        },
      ]),
    ).toBe(1);

    expect(
      db.prepare('SELECT trigger_id, field, value FROM notification_rule_template').all(),
    ).toEqual([{ trigger_id: 'slack.ops', field: 'simpleTitle', value: 'ok' }]);
  });

  test('writes no trigger or template rows when neither is present', () => {
    expect(run([{ id: 'plain-rule' }])).toBe(1);

    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_rule_trigger').get()).toEqual({
      n: 0,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_rule_template').get()).toEqual({
      n: 0,
    });
  });

  test('skips a document missing or with a blank id', () => {
    expect(run([{ name: 'no id' }, { id: '' }, { id: '   ' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_rules').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
