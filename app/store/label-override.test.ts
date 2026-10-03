import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as labelOverride from './label-override.js';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../log/index.js', () => ({ default: { child: () => logMock } }));

let db: Database;

const WEB = { name: 'web', watcher: 'local', agent: undefined, labels: {} };
const COMPOSE_SONARR = {
  name: 'media-sonarr-1',
  watcher: 'local',
  agent: undefined,
  labels: { 'com.docker.compose.project': 'media', 'com.docker.compose.service': 'sonarr' },
};

function scopeOf(target: Parameters<typeof labelOverride.deriveLabelOverrideScope>[0]) {
  const scope = labelOverride.deriveLabelOverrideScope(target);
  if (!scope) {
    throw new Error('no scope');
  }
  return scope;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMigratedMemoryDatabase();
  labelOverride.createCollections(db);
});

afterEach(() => {
  labelOverride.clearCollectionForTesting();
  db.close();
});

describe('store/label-override', () => {
  describe('scope derivation', () => {
    test('a plain container is scoped by agent, watcher and name', () => {
      expect(scopeOf({ ...WEB, agent: 'edge' })).toEqual({
        key: 'edge::local::web',
        agent: 'edge',
        watcher: 'local',
        kind: 'container',
        name: 'web',
      });
      expect(scopeOf(WEB)).toMatchObject({ key: '::local::web', agent: '' });
    });

    test('Compose replicas share one scope named project/service', () => {
      expect(scopeOf(COMPOSE_SONARR)).toEqual({
        key: '::local::compose:media/sonarr',
        agent: '',
        watcher: 'local',
        kind: 'compose-service',
        name: 'media/sonarr',
      });
      expect(scopeOf({ ...COMPOSE_SONARR, name: 'media-sonarr-2' }).key).toBe(
        scopeOf(COMPOSE_SONARR).key,
      );
    });

    test('a rollback-renamed record keeps its original scope', () => {
      expect(scopeOf({ ...WEB, name: 'web-old-1760000000000' }).key).toBe(scopeOf(WEB).key);
    });

    test('a record with no watcher or name has no scope', () => {
      expect(labelOverride.deriveLabelOverrideScope({ ...WEB, watcher: '' })).toBeUndefined();
      expect(
        labelOverride.deriveLabelOverrideScope({ ...WEB, name: undefined as never }),
      ).toBeUndefined();
    });
  });

  describe('writes', () => {
    test('the first set creates the row at revision 1 and later writes bump it', () => {
      const scope = scopeOf(WEB);
      const created = labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'user:admin',
        0,
      );
      expect(created.applied).toBe(true);
      expect(created.record).toMatchObject({
        scopeKey: '::local::web',
        agent: '',
        watcher: 'local',
        scopeKind: 'container',
        scopeName: 'web',
        revision: 1,
        fields: { displayName: { value: 'TV', updatedBy: 'user:admin' } },
      });

      const updated = labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'actionTriggerExclude', op: 'set', value: ['docker.local:minor'] }],
        'api-key:k1',
        1,
      );
      expect(updated.record?.revision).toBe(2);
      expect(Object.keys(updated.record?.fields ?? {})).toEqual([
        'displayName',
        'actionTriggerExclude',
      ]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM container_label_overrides').get()).toEqual({
        n: 1,
      });
    });

    test('a stale revision writes nothing and returns the current row', () => {
      const scope = scopeOf(WEB);
      labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'u',
      );
      const stale = labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'displayName', op: 'set', value: 'Other' }],
        'u',
        7,
      );
      expect(stale.applied).toBe(false);
      expect(stale.record?.fields.displayName?.value).toBe('TV');

      const missing = labelOverride.writeLabelOverrideChanges(
        scopeOf({ ...WEB, name: 'other' }),
        [{ field: 'displayName', op: 'set', value: 'x' }],
        'u',
        3,
      );
      expect(missing).toEqual({ applied: false, record: undefined });
    });

    test('removing the last field deletes the row, and removing an unset field is a no-op', () => {
      const scope = scopeOf(WEB);
      labelOverride.writeLabelOverrideChanges(
        scope,
        [
          { field: 'displayName', op: 'set', value: 'TV' },
          { field: 'dependsOn', op: 'set', value: [] },
        ],
        'u',
      );
      const partial = labelOverride.writeLabelOverrideChanges(
        scope,
        [
          { field: 'displayName', op: 'remove' },
          { field: 'displayIcon', op: 'remove' },
        ],
        'u',
      );
      expect(Object.keys(partial.record?.fields ?? {})).toEqual(['dependsOn']);

      const emptied = labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'dependsOn', op: 'remove' }],
        'u',
      );
      expect(emptied).toEqual({ applied: true, record: undefined });
      expect(labelOverride.getLabelOverrideForScope(scope.key)).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM container_label_overrides').get()).toEqual({
        n: 0,
      });
      // Nothing to delete is still a clean write.
      expect(
        labelOverride.writeLabelOverrideChanges(scope, [{ field: 'dependsOn', op: 'remove' }], 'u'),
      ).toEqual({ applied: true, record: undefined });
    });

    test.each([
      ['an unknown field', { field: 'labels', op: 'set', value: 'x' }],
      ['an unknown field on remove', { field: 'constructor', op: 'remove' }],
      ['a prototype key', { field: '__proto__', op: 'set', value: ['a'] }],
      ['a list where text belongs', { field: 'displayName', op: 'set', value: ['a'] }],
      ['empty text', { field: 'displayName', op: 'set', value: '' }],
      ['a bad action', { field: 'dependsOnAction', op: 'set', value: 'explode' }],
      ['text where a list belongs', { field: 'actionTriggerInclude', op: 'set', value: 'a' }],
    ])('rejects %s without writing', (_name, change) => {
      expect(() =>
        labelOverride.writeLabelOverrideChanges(
          scopeOf(WEB),
          [change as labelOverride.LabelOverrideChange],
          'u',
        ),
      ).toThrow(labelOverride.LabelOverrideValidationError);
      expect(db.prepare('SELECT COUNT(*) AS n FROM container_label_overrides').get()).toEqual({
        n: 0,
      });
    });

    test('rejects two changes to one field', () => {
      expect(() =>
        labelOverride.writeLabelOverrideChanges(
          scopeOf(WEB),
          [
            { field: 'displayName', op: 'set', value: 'a' },
            { field: 'displayName', op: 'remove' },
          ],
          'u',
        ),
      ).toThrow(/Duplicate change for displayName/);
    });
  });

  describe('reads and deletes', () => {
    test('rows are listed by scope key, found by id, and returned as copies', () => {
      const web = labelOverride.writeLabelOverrideChanges(
        scopeOf(WEB),
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'u',
      ).record;
      labelOverride.writeLabelOverrideChanges(
        scopeOf(COMPOSE_SONARR),
        [{ field: 'displayIcon', op: 'set', value: 'sh:sonarr' }],
        'u',
      );

      expect(labelOverride.getLabelOverrides().map((row) => row.scopeKey)).toEqual([
        '::local::compose:media/sonarr',
        '::local::web',
      ]);
      const found = labelOverride.getLabelOverrideById(web?.id as string);
      expect(found?.scopeKey).toBe('::local::web');
      (found as labelOverride.LabelOverrideRecord).fields.displayName = undefined;
      expect(
        labelOverride.getLabelOverrideForScope('::local::web')?.fields.displayName,
      ).toBeDefined();
      expect(labelOverride.getLabelOverrideById('nope')).toBeUndefined();
      expect(labelOverride.getLabelOverrideFields('::local::none')).toBeUndefined();
    });

    test('rows come back ordered by scope key whatever order they were written in', () => {
      for (const name of ['c', 'a', 'b']) {
        labelOverride.writeLabelOverrideChanges(
          scopeOf({ ...WEB, name }),
          [{ field: 'displayName', op: 'set', value: name }],
          'u',
        );
      }
      expect(labelOverride.getLabelOverrides().map((row) => row.scopeName)).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    test('deleting a row needs its revision, and an orphan can be deleted', () => {
      const row = labelOverride.writeLabelOverrideChanges(
        scopeOf(WEB),
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'u',
      ).record as labelOverride.LabelOverrideRecord;

      expect(labelOverride.deleteLabelOverrideRow(row.id, 9)).toBeUndefined();
      expect(labelOverride.getLabelOverrideById(row.id)).toBeDefined();
      expect(labelOverride.deleteLabelOverrideRow(row.id, 1)?.scopeKey).toBe('::local::web');
      expect(labelOverride.getLabelOverrideById(row.id)).toBeUndefined();
    });
  });

  describe('load and rollback', () => {
    test('createCollections loads every stored row and warns once per unreadable one', () => {
      const insert = db.prepare(
        `INSERT INTO container_label_overrides
           (id, scope_key, agent, watcher, scope_kind, scope_name, fields, revision, created_at, updated_at)
         VALUES (?, ?, '', 'local', 'container', ?, ?, 1, 'now', 'now')`,
      );
      insert.run(
        'good',
        '::local::good',
        'good',
        JSON.stringify({ displayName: { value: 'G', updatedAt: 'a', updatedBy: 'b' } }),
      );
      insert.run(
        'bad',
        '::local::bad',
        'bad',
        JSON.stringify({
          displayName: { value: 'B', updatedAt: 'a', updatedBy: 'b' },
          displayIcon: 'broken',
        }),
      );
      insert.run('garbled', '::local::garbled', 'garbled', '{nope');

      labelOverride.createCollections(db);

      expect(labelOverride.getLabelOverrideFields('::local::good')?.displayName?.value).toBe('G');
      expect(labelOverride.getLabelOverrideForScope('::local::bad')?.invalid).toEqual([
        { field: 'displayIcon', reason: 'invalid value' },
      ]);
      expect(labelOverride.getLabelOverrideFields('::local::garbled')).toEqual({});
      expect(logMock.warn).toHaveBeenCalledTimes(2);
    });

    test('a rolled back transaction leaves the cache as the table is', () => {
      const scope = scopeOf(WEB);
      expect(() =>
        labelOverride.transaction(() => {
          labelOverride.writeLabelOverrideChanges(
            scope,
            [{ field: 'displayName', op: 'set', value: 'TV' }],
            'u',
          );
          expect(labelOverride.getLabelOverrideFields(scope.key)).toBeDefined();
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(labelOverride.getLabelOverrideFields(scope.key)).toBeUndefined();
      expect(labelOverride.transaction(() => 7)).toBe(7);
    });

    test('every operation fails loudly before the collection is initialized', () => {
      labelOverride.clearCollectionForTesting();
      expect(() => labelOverride.transaction(() => 1)).toThrow(
        'label overrides collection not initialized',
      );
      expect(() => labelOverride.writeLabelOverrideChanges(scopeOf(WEB), [], 'u')).toThrow(
        'label overrides collection not initialized',
      );
      expect(() => labelOverride.deleteLabelOverrideRow('x', 1)).toThrow(
        'label overrides collection not initialized',
      );
    });
  });
});
