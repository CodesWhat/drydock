import path from 'node:path';
import * as event from '../event/index.js';
import type { Container } from '../model/container.js';
import { applyDeclarativeUpdatePolicy } from '../model/update-policy.js';
import { createContainerFixture } from '../test/helpers.js';
import {
  createMigratedMemoryDatabase,
  createTemporaryStoreDirectory,
  removeTemporaryStoreDirectory,
} from '../test/sqlite-db.js';
import * as container from './container.js';
import { type Database, openDatabase } from './db/driver.js';
import * as groupPolicy from './group-policy.js';
import * as labelOverride from './label-override.js';

vi.mock('../event');

let db: Database;

beforeEach(() => {
  vi.resetAllMocks();
  container._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  container.createCollections(db);
  groupPolicy.createCollections(db);
  labelOverride.createCollections(db);
});

afterEach(() => {
  vi.useRealTimers();
  labelOverride.clearCollectionForTesting();
  groupPolicy.clearCollectionForTesting();
  db.close();
});

const COMPOSE_SONARR = {
  'com.docker.compose.project': 'media',
  'com.docker.compose.service': 'sonarr',
};

/** A container the way the Docker watcher hands it to the store. */
function watched(id: string, overrides: Record<string, unknown> = {}, name = 'web'): Container {
  return createContainerFixture({
    id,
    name,
    displayName: name,
    watcher: 'local',
    labels: {},
    ...overrides,
  }) as unknown as Container;
}

function sonarr(id: string, overrides: Record<string, unknown> = {}) {
  return watched(id, { labels: COMPOSE_SONARR, ...overrides }, `media-sonarr-${id}`);
}

function setOverrides(
  target: Pick<Container, 'name' | 'watcher' | 'agent' | 'labels'>,
  fields: Record<string, unknown>,
  expectedRevision?: number,
) {
  return container.mutateLabelOverrides(
    target,
    Object.entries(fields).map(([field, value]) => ({ field, op: 'set' as const, value })),
    'user:admin',
    expectedRevision,
  );
}

function resetOverrides(target: Pick<Container, 'name' | 'watcher' | 'agent' | 'labels'>) {
  const scope = labelOverride.deriveLabelOverrideScope(target);
  const fields = Object.keys(labelOverride.getLabelOverrideFields(scope?.key as string) ?? {});
  return container.mutateLabelOverrides(
    target,
    fields.map((field) => ({ field, op: 'remove' as const })),
    'user:admin',
  );
}

const emitted = () => vi.mocked(event.emitContainerUpdated);

function raw(id: string) {
  return container.getContainerRaw(id) as Container;
}

function storedLabelOwned(id: string) {
  const row = db.prepare('SELECT label_owned FROM containers WHERE id = ?').get(id);
  return row?.label_owned === null ? null : JSON.parse(String(row?.label_owned));
}

/** Write a row straight into the table, the way a record already on disk arrives. */
function seedRow(rawContainer: unknown) {
  const row = container.buildImportedContainerRow(rawContainer);
  if (!row) {
    throw new Error('seed failed validation');
  }
  container.insertImportedContainerRow(db, row);
}

describe('label-owned overrides at the store', () => {
  describe('with no override anywhere', () => {
    test('a write is exactly what it was before overrides: no state, flat values accepted', () => {
      const inserted = container.insertContainer(
        watched('web-1', {
          displayName: 'Sonarr',
          labels: { 'dd.action.include': 'docker.local' },
          dependsOn: ['db'],
          dependsOnSource: 'label',
        }),
      );
      expect(inserted).not.toHaveProperty('labelOwned');
      expect(storedLabelOwned('web-1')).toBeNull();

      const updated = container.updateContainer({ ...inserted, displayName: 'Renamed' });
      expect(updated.displayName).toBe('Renamed');
      expect(updated).not.toHaveProperty('labelOwned');
      const patched = container.updateContainerFields('web-1', {
        displayIcon: 'sh:web',
        dependsOn: ['cache'],
      });
      expect(patched).toMatchObject({ displayIcon: 'sh:web', dependsOn: ['cache'] });
      expect(patched).not.toHaveProperty('labelOwned');
    });

    test('a row with an unreadable stored state reads as having none', () => {
      const seeded = container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
      expect(seeded).not.toHaveProperty('labelOwned');
      // An unreadable state document reads as no state.
      db.prepare("UPDATE containers SET label_owned = '{\"v\":9}' WHERE id = 'web-1'").run();
      expect(raw('web-1')).not.toHaveProperty('labelOwned');
      db.prepare("UPDATE containers SET label_owned = 'garbage' WHERE id = 'web-1'").run();
      expect(() => raw('web-1')).not.toThrow();
    });
  });

  describe('applying an override on insert', () => {
    test('effective values reach every flat field, the state and the column', () => {
      setOverrides(watched('x'), {
        displayName: 'TV',
        displayIcon: 'sh:sonarr',
        dependsOn: ['db', 'cache'],
        dependsOnAction: 'restart',
        notificationTriggerInclude: ['slack.ops:major'],
        actionTriggerAuto: ['docker.local'],
      });

      const inserted = container.insertContainer(
        watched('web-1', {
          displayName: 'Sonarr',
          labels: { 'dd.display.name': 'Sonarr', 'dd.action.auto': 'docker.other' },
          actionTriggerAuto: 'docker.other',
          dependsOn: ['label-dep'],
          dependsOnSource: 'label',
        }),
      );

      expect(inserted).toMatchObject({
        displayName: 'TV',
        displayIcon: 'sh:sonarr',
        dependsOn: ['db', 'cache'],
        dependsOnSource: 'override',
        dependsOnAction: 'restart',
        notificationTriggerInclude: 'slack.ops:major',
        actionTriggerAuto: 'docker.local',
      });
      expect(inserted.labelOwned?.declared).toMatchObject({
        displayName: 'Sonarr',
        actionTriggerAuto: 'docker.other',
        dependsOn: ['label-dep'],
      });
      expect(inserted.labelOwned?.declaredSources).toMatchObject({
        displayName: 'label',
        actionTriggerAuto: 'label',
        dependsOn: 'label',
      });
      expect(inserted.labelOwned?.sources).toMatchObject({
        displayName: 'override',
        actionTriggerAuto: 'override',
        dependsOnAction: 'override',
        notificationTriggerExclude: 'unset',
      });
      expect(storedLabelOwned('web-1')).toEqual(JSON.parse(JSON.stringify(inserted.labelOwned)));
      expect(raw('web-1')).toMatchObject({
        displayName: 'TV',
        dependsOn: ['db', 'cache'],
        dependsOnSource: 'override',
        notificationTriggerInclude: 'slack.ops:major',
        labelOwned: inserted.labelOwned,
      });
    });

    test('a scope with an override of one field leaves every other field alone', () => {
      setOverrides(watched('x'), { displayName: 'TV' });
      const inserted = container.insertContainer(
        watched('web-1', { displayIcon: 'hl:web', actionTriggerInclude: 'docker.local' }),
      );
      expect(inserted).toMatchObject({
        displayName: 'TV',
        displayIcon: 'hl:web',
        actionTriggerInclude: 'docker.local',
      });
      expect(inserted.labelOwned?.sources.displayIcon).toBe('watcher');
    });

    test('an incoming state on an insert is an internal round trip and is honored', () => {
      setOverrides(watched('x'), { displayName: 'TV' });
      const roundTrip = {
        ...watched('web-1', { displayName: 'ignored flat value' }),
        labelOwned: {
          v: 1 as const,
          declared: { displayName: 'From state' },
          declaredSources: {
            displayName: 'watcher',
            displayIcon: 'unset',
            dependsOn: 'unset',
            dependsOnAction: 'unset',
            notificationTriggerInclude: 'unset',
            notificationTriggerExclude: 'unset',
            actionTriggerInclude: 'unset',
            actionTriggerExclude: 'unset',
            actionTriggerAuto: 'unset',
          },
          sources: {} as never,
        },
      } as Container;
      const inserted = container.insertContainer(roundTrip);
      expect(inserted.displayName).toBe('TV');
      expect(inserted.labelOwned?.declared.displayName).toBe('From state');
      expect(inserted.labelOwned?.sources.displayName).toBe('override');

      // With no override anywhere, the same payload keeps its state too.
      resetOverrides(watched('x'));
      const kept = container.insertContainer({ ...roundTrip, id: 'web-2', name: 'web2' });
      expect(kept.displayName).toBe('From state');
      expect(kept.labelOwned?.declared.displayName).toBe('From state');
    });
  });

  describe('empty-list overrides', () => {
    test('normalization cannot refill a cleared include from the labels', () => {
      setOverrides(watched('x'), { actionTriggerInclude: [], notificationTriggerExclude: [] });
      const labels = {
        'dd.action.include': 'docker.local',
        'dd.notification.exclude': 'slack.noisy',
      };
      const inserted = container.insertContainer(
        watched('web-1', {
          labels,
          actionTriggerInclude: 'docker.local',
          notificationTriggerExclude: 'slack.noisy',
        }),
      );
      expect(inserted.actionTriggerInclude).toBeUndefined();
      expect(inserted.notificationTriggerExclude).toBeUndefined();
      expect(inserted.labelOwned?.sources).toMatchObject({
        actionTriggerInclude: 'override',
        notificationTriggerExclude: 'override',
      });

      // Every later write normalizes again and still cannot resurrect it.
      const whole = container.updateContainer({ ...raw('web-1'), status: 'exited' });
      expect(whole.actionTriggerInclude).toBeUndefined();
      const patched = container.updateContainerFields('web-1', { health: 'healthy' });
      expect(patched?.actionTriggerInclude).toBeUndefined();
      expect(raw('web-1').notificationTriggerExclude).toBeUndefined();
      expect(raw('web-1').labelOwned?.declared.actionTriggerInclude).toBe('docker.local');
    });

    test('an empty dependency override is an explicit none sourced as override', () => {
      setOverrides(watched('x'), { dependsOn: [] });
      const inserted = container.insertContainer(
        watched('web-1', { dependsOn: ['db'], dependsOnSource: 'compose' }),
      );
      expect(inserted.dependsOn).toEqual([]);
      expect(inserted.dependsOnSource).toBe('override');
      expect(raw('web-1')).toMatchObject({ dependsOn: [], dependsOnSource: 'override' });
    });
  });

  describe('durability across recreation', () => {
    test('a recreate under a new Docker id reapplies the override after an 8 day gap', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
      container.insertContainer(watched('old-id', { displayName: 'Sonarr' }));
      setOverrides(watched('x'), { displayName: 'TV', actionTriggerExclude: ['docker.local'] });
      expect(raw('old-id').displayName).toBe('TV');

      container.deleteContainer('old-id', { replacementExpected: true });
      vi.setSystemTime(new Date('2026-10-09T00:00:01Z'));

      const recreated = container.insertContainer(watched('new-id', { displayName: 'Sonarr' }));
      expect(recreated).toMatchObject({ displayName: 'TV', actionTriggerExclude: 'docker.local' });
      expect(recreated.labelOwned?.declared.displayName).toBe('Sonarr');
    });

    test('overrides survive a restart: close and reopen the database file', async () => {
      const directory = createTemporaryStoreDirectory();
      const file = path.join(directory, 'dd.sqlite');
      try {
        const first = openDatabase(file);
        const { migrate } = await import('./db/migrations.js');
        migrate(first);
        container.createCollections(first);
        labelOverride.createCollections(first);
        container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
        setOverrides(watched('x'), { displayName: 'TV', dependsOn: ['db'] });
        first.close();

        const second = openDatabase(file);
        container._resetContainerStoreStateForTests();
        container.createCollections(second);
        labelOverride.createCollections(second);
        expect(raw('web-1')).toMatchObject({
          displayName: 'TV',
          dependsOn: ['db'],
          dependsOnSource: 'override',
        });
        expect(raw('web-1').labelOwned?.declared.displayName).toBe('Sonarr');
        // And a fresh container is still caught by the reloaded row.
        expect(container.insertContainer(watched('web-2', {}, 'web')).displayName).toBe('TV');
        second.close();
      } finally {
        removeTemporaryStoreDirectory(directory);
      }
    });
  });

  describe('scope', () => {
    test('Compose replicas of one service share an override and other services do not', () => {
      container.insertContainer(sonarr('1'));
      container.insertContainer(sonarr('2'));
      container.insertContainer(
        watched(
          'radarr',
          { labels: { ...COMPOSE_SONARR, 'com.docker.compose.service': 'radarr' } },
          'media-radarr-1',
        ),
      );
      const result = setOverrides(sonarr('1'), { displayName: 'TV' });

      expect(result.refreshed).toBe(2);
      expect(raw('1').displayName).toBe('TV');
      expect(raw('2').displayName).toBe('TV');
      expect(raw('radarr').displayName).toBe('media-radarr-1');
      expect(result.record?.scopeKind).toBe('compose-service');
      expect(result.record?.scopeName).toBe('media/sonarr');
    });

    test('the same name on another watcher or another agent does not match', () => {
      container.insertContainer(watched('local-web'));
      container.insertContainer(watched('other-watcher', { watcher: 'remote' }));
      container.insertContainer(watched('agent-web', { agent: 'edge' }));
      const result = setOverrides(watched('local-web'), { displayName: 'TV' });

      expect(result.refreshed).toBe(1);
      expect(raw('local-web').displayName).toBe('TV');
      expect(raw('other-watcher').displayName).toBe('web');
      expect(raw('agent-web').displayName).toBe('web');
      expect(storedLabelOwned('agent-web')).toBeNull();

      // An agent scope matches only that agent's containers.
      setOverrides(watched('agent-web', { agent: 'edge' }), { displayName: 'Edge' });
      expect(raw('agent-web').displayName).toBe('Edge');
      expect(raw('local-web').displayName).toBe('TV');
    });

    test('rollback-named records follow the override of their original name', () => {
      container.insertContainer(watched('old', {}, 'web-old-1760000000000'));
      container.insertContainer(watched('current'));
      emitted().mockClear();

      const result = setOverrides(watched('current'), { displayName: 'TV' });

      expect(result.refreshed).toBe(2);
      expect(raw('old').displayName).toBe('TV');
      expect(raw('current').displayName).toBe('TV');
      // A rollback record is not a user-visible row, so it announces nothing.
      expect(emitted()).toHaveBeenCalledTimes(1);
    });
  });

  describe('declared writes', () => {
    test('a marked patch moves the declared value while the effective value stays the override', () => {
      container.insertContainer(
        watched('web-1', { displayName: 'Sonarr', labels: { 'dd.display.name': 'Sonarr' } }),
      );
      setOverrides(watched('x'), { displayName: 'TV' });

      const patched = container.updateContainerFields(
        'web-1',
        { displayName: 'Sonarr v2', labels: { 'dd.display.name': 'Sonarr v2' } },
        undefined,
        { labelOwned: 'declared' },
      );

      expect(patched?.displayName).toBe('TV');
      expect(patched?.labelOwned?.declared.displayName).toBe('Sonarr v2');
      expect(patched?.labelOwned?.declaredSources.displayName).toBe('label');
      expect(patched?.labelOwned?.sources.displayName).toBe('override');

      // Resetting then shows the newest declared value, not the one at override time.
      resetOverrides(watched('x'));
      expect(raw('web-1')).toMatchObject({ displayName: 'Sonarr v2' });
      expect(raw('web-1').labelOwned?.sources.displayName).toBe('label');
    });

    test('a marked patch only takes the fields it names and can clear one', () => {
      container.insertContainer(
        watched('web-1', {
          displayIcon: 'hl:web',
          actionTriggerExclude: 'docker.local',
          dependsOn: ['db'],
          dependsOnSource: 'compose',
        }),
      );
      setOverrides(watched('x'), { displayName: 'TV', dependsOn: ['api'] });

      const patched = container.updateContainerFields(
        'web-1',
        { actionTriggerExclude: undefined, dependsOn: ['db', 'cache'], dependsOnSource: 'label' },
        undefined,
        { labelOwned: 'declared' },
      );

      expect(patched?.labelOwned?.declared).toMatchObject({
        displayIcon: 'hl:web',
        dependsOn: ['db', 'cache'],
      });
      expect(patched?.labelOwned?.declared).not.toHaveProperty('actionTriggerExclude');
      expect(patched?.labelOwned?.declaredSources.dependsOn).toBe('label');
      expect(patched).toMatchObject({ dependsOn: ['api'], dependsOnSource: 'override' });
      expect(patched?.actionTriggerExclude).toBeUndefined();
    });

    test('a marked dependency patch with no source keeps the stored declared source', () => {
      container.insertContainer(
        watched('web-1', { dependsOn: ['db'], dependsOnSource: 'compose' }),
      );
      setOverrides(watched('x'), { displayName: 'TV' });
      const patched = container.updateContainerFields(
        'web-1',
        { dependsOn: ['db', 'cache'] },
        undefined,
        { labelOwned: 'declared' },
      );
      expect(patched?.labelOwned?.declaredSources.dependsOn).toBe('compose');
      expect(patched).toMatchObject({ dependsOn: ['db', 'cache'], dependsOnSource: 'compose' });
    });

    test('a marked whole-record write takes every in-scope field as declared', () => {
      container.insertContainer(
        watched('web-1', { displayName: 'Sonarr', actionTriggerInclude: 'docker.local' }),
      );
      setOverrides(watched('x'), { displayName: 'TV' });

      const incoming = watched('web-1', {
        displayName: 'Agent name',
        displayIcon: 'sh:agent',
        dependsOn: ['db'],
        dependsOnSource: 'override',
      });
      const written = container.updateContainer(incoming, { labelOwned: 'declared' });

      expect(written.displayName).toBe('TV');
      expect(written.labelOwned?.declared).toMatchObject({
        displayName: 'Agent name',
        displayIcon: 'sh:agent',
        dependsOn: ['db'],
      });
      // The incoming flat value is a reading of the agent's labels; the actionTriggerInclude
      // the agent no longer reports is gone from the declared layer.
      expect(written.labelOwned?.declared).not.toHaveProperty('actionTriggerInclude');
      // A claimed 'override' source from outside is not a declared source.
      expect(written.labelOwned?.declaredSources.dependsOn).toBe('unset');
      expect(written.dependsOnSource).toBeUndefined();
    });
  });

  describe('stale writers', () => {
    test('a stale whole-record writeback leaves declared intact and the override effective', () => {
      container.insertContainer(
        watched('web-1', { displayName: 'Sonarr', actionTriggerInclude: 'docker.local' }),
      );
      const stale = raw('web-1');
      setOverrides(watched('x'), { displayName: 'TV', actionTriggerInclude: [] });

      const written = container.updateContainer({ ...stale, status: 'exited' });

      expect(written.status).toBe('exited');
      expect(written.displayName).toBe('TV');
      expect(written.actionTriggerInclude).toBeUndefined();
      expect(written.labelOwned?.declared).toMatchObject({
        displayName: 'Sonarr',
        actionTriggerInclude: 'docker.local',
      });
    });

    test('a stale copy that read the override cannot make it the label after a reset', () => {
      container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
      setOverrides(watched('x'), { displayName: 'TV' });
      const stale = raw('web-1');
      expect(stale.displayName).toBe('TV');
      resetOverrides(watched('x'));
      expect(raw('web-1').displayName).toBe('Sonarr');

      const written = container.updateContainer({ ...stale, status: 'exited' });

      expect(written.displayName).toBe('Sonarr');
      expect(written.labelOwned?.declared.displayName).toBe('Sonarr');
    });

    test('an unmarked patch naming a label-owned field is ignored once state exists', () => {
      container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
      setOverrides(watched('x'), { displayName: 'TV' });
      const patched = container.updateContainerFields('web-1', {
        displayName: 'Stale',
        health: 'healthy',
      });
      expect(patched).toMatchObject({ displayName: 'TV', health: 'healthy' });
      expect(patched?.labelOwned?.declared.displayName).toBe('Sonarr');
    });
  });

  describe('rows with no state', () => {
    test('the first mutation captures declared from the pristine flat values before applying', () => {
      seedRow(
        watched('seeded', {
          displayName: 'Sonarr',
          displayIcon: 'hl:sonarr',
          actionTriggerInclude: 'docker.local',
          dependsOn: ['db'],
          dependsOnSource: 'compose',
        }),
      );
      expect(storedLabelOwned('seeded')).toBeNull();

      setOverrides(watched('x'), { displayName: 'TV', actionTriggerInclude: ['slack.a'] });

      expect(raw('seeded')).toMatchObject({
        displayName: 'TV',
        actionTriggerInclude: 'slack.a',
        displayIcon: 'hl:sonarr',
        dependsOn: ['db'],
        dependsOnSource: 'compose',
      });
      expect(raw('seeded').labelOwned?.declared).toMatchObject({
        displayName: 'Sonarr',
        actionTriggerInclude: 'docker.local',
      });
      expect(raw('seeded').labelOwned?.declaredSources.dependsOn).toBe('compose');
    });

    test('a first write to a stateless row under an existing override captures before applying', () => {
      seedRow(watched('seeded', { displayName: 'Sonarr' }));
      // An override that exists without its rows having been refreshed: a row written
      // before the table was loaded, or imported by the first-start LokiJS migration.
      labelOverride.writeLabelOverrideChanges(
        labelOverride.deriveLabelOverrideScope(watched('x')) as labelOverride.LabelOverrideScope,
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'user:admin',
      );
      expect(storedLabelOwned('seeded')).toBeNull();

      const written = container.updateContainerFields('seeded', { health: 'healthy' });

      expect(written?.displayName).toBe('TV');
      expect(written?.labelOwned?.declared.displayName).toBe('Sonarr');
    });
  });

  describe('mutation', () => {
    test('rewrites every affected row, announces each once, and reset restores the declared values', () => {
      container.insertContainer(
        sonarr('1', { displayName: 'Sonarr', dependsOn: ['db'], dependsOnSource: 'compose' }),
      );
      container.insertContainer(sonarr('2', { displayName: 'Sonarr' }));
      emitted().mockClear();

      const result = setOverrides(sonarr('1'), {
        displayIcon: 'sh:sonarr',
        actionTriggerAuto: ['docker.local'],
        dependsOn: ['api'],
      });

      expect(result).toMatchObject({ applied: true, refreshed: 2 });
      expect(result.record?.revision).toBe(1);
      expect(emitted()).toHaveBeenCalledTimes(2);
      expect(raw('1')).toMatchObject({
        displayIcon: 'sh:sonarr',
        actionTriggerAuto: 'docker.local',
        dependsOn: ['api'],
        dependsOnSource: 'override',
      });

      emitted().mockClear();
      const reset = resetOverrides(sonarr('1'));
      expect(reset).toMatchObject({ applied: true, refreshed: 2, record: undefined });
      expect(emitted()).toHaveBeenCalledTimes(2);
      expect(raw('1')).toMatchObject({
        displayIcon: 'mdi:docker',
        dependsOn: ['db'],
        dependsOnSource: 'compose',
      });
      expect(raw('1').actionTriggerAuto).toBeUndefined();
      expect(raw('2').dependsOn).toBeUndefined();
      expect(raw('1').labelOwned?.sources.displayIcon).toBe('default');
      expect(labelOverride.getLabelOverrides()).toEqual([]);
    });

    test('icon, routing and dependency changes each emit container-updated', () => {
      container.insertContainer(watched('web-1'));
      for (const [field, value] of [
        ['displayIcon', 'sh:web'],
        ['notificationTriggerInclude', ['slack.a']],
        ['dependsOnAction', 'restart'],
        ['dependsOn', ['db']],
      ] as const) {
        emitted().mockClear();
        setOverrides(watched('web-1'), { [field]: value });
        expect(emitted(), field).toHaveBeenCalledTimes(1);
      }
    });

    test('a watcher-side change to a label-owned field announces the container too', () => {
      container.insertContainer(watched('web-1'));
      emitted().mockClear();
      container.updateContainerFields('web-1', { displayIcon: 'sh:web' });
      container.updateContainerFields('web-1', { actionTriggerExclude: 'docker.local' });
      container.updateContainerFields('web-1', { dependsOn: ['db'] });
      expect(emitted()).toHaveBeenCalledTimes(3);
      container.updateContainerFields('web-1', { dependsOn: ['db'] });
      expect(emitted()).toHaveBeenCalledTimes(3);
    });

    test('a write that changes nothing the scope can see rewrites no rows', () => {
      container.insertContainer(watched('web-1', { displayName: 'TV' }));
      container.insertContainer(watched('radarr', {}, 'radarr'));
      setOverrides(watched('web-1'), { displayName: 'TV' });
      emitted().mockClear();
      const writes = vi.spyOn(db, 'prepare');

      const again = setOverrides(watched('web-1'), { displayName: 'TV' });

      expect(again.refreshed).toBe(0);
      expect(emitted()).not.toHaveBeenCalled();
      expect(
        writes.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE containers')),
      ).toEqual([]);
    });

    test('removing an override from a row that never had state leaves the row alone', () => {
      seedRow(watched('seeded', { displayName: 'Sonarr' }));
      const scope = labelOverride.deriveLabelOverrideScope(
        watched('x'),
      ) as labelOverride.LabelOverrideScope;
      labelOverride.writeLabelOverrideChanges(
        scope,
        [{ field: 'displayName', op: 'set', value: 'TV' }],
        'user:admin',
      );
      emitted().mockClear();

      const result = resetOverrides(watched('x'));

      expect(result).toMatchObject({ applied: true, refreshed: 0 });
      expect(storedLabelOwned('seeded')).toBeNull();
      expect(raw('seeded').displayName).toBe('Sonarr');
      expect(emitted()).not.toHaveBeenCalled();
    });

    test('a stale revision writes nothing and rewrites nothing', () => {
      container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
      setOverrides(watched('web-1'), { displayName: 'TV' });
      emitted().mockClear();

      const stale = setOverrides(watched('web-1'), { displayName: 'Other' }, 5);

      expect(stale).toMatchObject({ applied: false, refreshed: 0 });
      expect(raw('web-1').displayName).toBe('TV');
      expect(emitted()).not.toHaveBeenCalled();
      expect(setOverrides(watched('web-1'), { displayName: 'Second' }, 1).record?.revision).toBe(2);
    });

    test('an invalid change or a scope that cannot be derived throws and changes nothing', () => {
      container.insertContainer(watched('web-1', { displayName: 'Sonarr' }));
      expect(() => setOverrides(watched('web-1'), { displayName: ['not text'] })).toThrow(
        labelOverride.LabelOverrideValidationError,
      );
      expect(() =>
        setOverrides({ ...watched('web-1'), watcher: '' }, { displayName: 'x' }),
      ).toThrow(/needs a watcher and a name/);
      expect(raw('web-1').displayName).toBe('Sonarr');
      expect(labelOverride.getLabelOverrides()).toEqual([]);
    });

    test('an override with no matching container is kept and applies to a later one', () => {
      const result = setOverrides(watched('ghost'), { displayName: 'TV' });
      expect(result).toMatchObject({ applied: true, refreshed: 0 });
      expect(labelOverride.getLabelOverrides()).toHaveLength(1);
      expect(container.insertContainer(watched('later')).displayName).toBe('TV');
    });
  });

  describe('composition with group policies', () => {
    test('the group layer and the label-owned layer each resolve their own fields', () => {
      const policy = groupPolicy.insertGroupPolicy(
        'payments',
        { updatePolicy: { maturityMode: 'mature' }, actions: { exclude: ['docker.local'] } },
        'user:admin',
      );
      const labels = { 'dd.group': 'payments', 'dd.action.exclude': 'docker.other' };
      const member = () =>
        applyDeclarativeUpdatePolicy(
          watched('member', { labels, actionTriggerExclude: 'docker.other' }),
          { env: {}, label: {} },
        );
      setOverrides(member(), { displayName: 'Pay', actionTriggerExclude: ['docker.local'] });

      const inserted = container.insertContainer(member());

      expect(inserted.updatePolicy).toEqual({ maturityMode: 'mature' });
      expect(inserted.updatePolicySources).toEqual({ maturityMode: 'group' });
      expect(inserted.groupPolicy?.id).toBe(policy.id);
      expect(inserted.displayName).toBe('Pay');
      expect(inserted.actionTriggerExclude).toBe('docker.local');
      // The group's own exclude list is untouched by a container override of the same label.
      expect(inserted.groupPolicy?.actions.exclude).toEqual(['docker.local']);
      expect(inserted.labelOwned?.declared.actionTriggerExclude).toBe('docker.other');
    });

    test('re-resolving a group and reconciling at startup keep the override', () => {
      const policy = groupPolicy.insertGroupPolicy(
        'payments',
        { updatePolicy: { maturityMode: 'mature' } },
        'user:admin',
      );
      container.insertContainer(
        applyDeclarativeUpdatePolicy(watched('member', { labels: { 'dd.group': 'payments' } }), {
          env: {},
          label: {},
        }),
      );
      setOverrides(watched('member', { labels: { 'dd.group': 'payments' } }), {
        displayName: 'Pay',
      });
      groupPolicy.replaceGroupPolicy(
        policy.id,
        1,
        { updatePolicy: { maturityMode: 'all' } },
        'user:admin',
      );

      expect(container.reResolveGroupPolicyMembers('payments')).toBe(1);
      expect(raw('member')).toMatchObject({
        displayName: 'Pay',
        updatePolicy: { maturityMode: 'all' },
      });
      expect(raw('member').labelOwned?.sources.displayName).toBe('override');
      expect(container.reconcileGroupPolicySnapshots()).toBe(0);
    });
  });
});
