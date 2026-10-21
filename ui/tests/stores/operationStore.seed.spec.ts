vi.mock('@/services/image-icon', () => ({
  getEffectiveDisplayIcon: vi.fn((_display: string, image: string) => `icon-${image}`),
}));

import { createPinia, setActivePinia } from 'pinia';
import { useOperationDisplayHold } from '@/composables/useOperationDisplayHold';
import { useOperationStore } from '@/stores/operations';
import { mapApiContainer } from '@/utils/container-mapper';
import { seedOperation } from '../helpers/operations';

function row(overrides: Record<string, unknown> = {}, operation?: Record<string, unknown> | null) {
  return {
    id: 'c1',
    name: 'web',
    watcher: 'local',
    agent: null,
    image: { registry: { name: 'hub', url: 'u' }, name: 'nginx', tag: { value: '1.0' } },
    updateAvailable: true,
    ...(operation === null
      ? {}
      : {
          updateOperation: {
            id: 'op-1',
            status: 'in-progress',
            phase: 'pulling',
            updatedAt: '2026-04-01T12:00:00.000Z',
            ...operation,
          },
        }),
    ...overrides,
  };
}

describe('operations store seeding', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useOperationDisplayHold().clearAllOperationDisplayHolds();
  });

  describe('seedFromContainerList', () => {
    it('ignores a non-array payload', () => {
      const store = useOperationStore();
      store.seedFromContainerList(undefined, Date.now());
      expect(store.byId).toEqual({});
    });

    it('upserts a valid active operation with list-only fields and indexes it', () => {
      const store = useOperationStore();
      const before = Date.now();
      store.seedFromContainerList(
        [
          row(
            {},
            {
              fromVersion: '1.0.0',
              toVersion: '1.1.0',
              batchId: 'b1',
              queuePosition: 2,
              queueTotal: 3,
            },
          ),
        ],
        before,
      );

      const op = store.byId['op-1'];
      expect(op).toMatchObject({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        identityKey: '::local::web',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        batchId: 'b1',
        queuePosition: 2,
        queueTotal: 3,
      });
      expect(op.lastSeenAt).toBeGreaterThanOrEqual(before);
      expect(store.getOperationByContainerId('c1')?.operationId).toBe('op-1');
      expect(store.getOperationByIdentityKey('::local::web')?.operationId).toBe('op-1');
    });

    it('drops batch fields that are inconsistent', () => {
      const store = useOperationStore();
      store.seedFromContainerList(
        [row({}, { batchId: 'b1', queuePosition: 5, queueTotal: 3 })],
        Date.now(),
      );
      expect(store.byId['op-1'].batchId).toBeUndefined();
      expect(store.byId['op-1'].queuePosition).toBeUndefined();
    });

    it('falls back to the id, then the name, for the identity key', () => {
      const store = useOperationStore();
      store.seedFromContainerList(
        [
          row({ watcher: undefined }, { id: 'op-a' }),
          row({ id: undefined, watcher: undefined, name: 'solo' }, { id: 'op-b' }),
        ],
        Date.now(),
      );
      expect(store.byId['op-a'].identityKey).toBe('c1');
      expect(store.byId['op-b'].identityKey).toBe('solo');
      expect(store.byId['op-b'].containerId).toBeUndefined();
    });

    it('omits row metadata the row does not carry', () => {
      const store = useOperationStore();
      store.seedFromContainerList(
        [{ updateOperation: { id: 'op-bare', status: 'queued', phase: 'queued', updatedAt: 'x' } }],
        Date.now(),
      );
      expect(store.byId['op-bare']).toEqual({
        operationId: 'op-bare',
        status: 'queued',
        phase: 'queued',
        updatedAt: 'x',
        lastSeenAt: expect.any(Number),
      });
    });

    it.each([
      ['a non-object row', 'nope'],
      ['a row without an operation', row({}, null)],
      ['a non-object operation', row({ updateOperation: 'x' }, null)],
      ['a missing id', row({}, { id: '' })],
      ['a terminal status', row({}, { status: 'succeeded', phase: 'succeeded' })],
      ['a phase invalid for the status', row({}, { status: 'queued', phase: 'pulling' })],
      ['a missing updatedAt', row({}, { updatedAt: undefined })],
    ])('ignores %s', (_label, input) => {
      const store = useOperationStore();
      store.seedFromContainerList([input], Date.now());
      expect(store.byId).toEqual({});
    });

    it('does not pull an SSE-terminal operation back to active (status-rank guard)', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.applyUpdateApplied({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        batchId: null,
        timestamp: new Date().toISOString(),
      });

      store.seedFromContainerList([row()], Date.now());

      expect(store.byId['op-1'].status).toBe('succeeded');
      expect(store.getOperationByContainerId('c1')).toBeUndefined();
      expect(store.byId['op-1'].fromVersion).toBeUndefined();
    });

    it('merges list-only fields into an SSE operation without losing its status', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'health-gate',
      });
      store.seedFromContainerList(
        [row({}, { status: 'queued', phase: 'queued', fromVersion: '1.0', toVersion: '2.0' })],
        Date.now(),
      );
      expect(store.byId['op-1']).toMatchObject({
        status: 'in-progress',
        phase: 'health-gate',
        fromVersion: '1.0',
        toVersion: '2.0',
        identityKey: '::local::web',
      });
    });

    it('aliases a recreated container id beside the original', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'old',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([row({ id: 'new' })], Date.now());
      expect(store.byId['op-1'].containerId).toBe('old');
      expect(store.byId['op-1'].newContainerId).toBeUndefined();
      expect(store.getOperationByContainerId('old')?.operationId).toBe('op-1');
      expect(store.getOperationForContainer({ id: 'new' })?.id).toBe('op-1');
    });

    it('keeps the same id when the row matches the stored container id', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row()], Date.now());
      store.seedFromContainerList([row({}, { phase: 'scanning' })], Date.now() + 10);
      expect(store.byId['op-1'].containerId).toBe('c1');
      expect(store.byId['op-1'].newContainerId).toBeUndefined();
      expect(store.byId['op-1'].phase).toBe('scanning');
    });

    it('keeps SSE-owned ids when a sibling row carries the same operation', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'A',
        newContainerId: 'A2',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([row({ id: 'B', name: 'web-2' })], Date.now() + 10);

      expect(store.byId['op-1'].containerId).toBe('A');
      expect(store.byId['op-1'].newContainerId).toBe('A2');
      expect(store.getOperationByContainerId('A2')?.operationId).toBe('op-1');
      expect(store.getOperationByContainerId('B')).toBeUndefined();
      expect(store.getOperationForContainer({ id: 'A2' })?.id).toBe('op-1');
      expect(store.getOperationForContainer({ id: 'B' })?.id).toBe('op-1');
    });

    it('clears a list alias when the row stops carrying the operation', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'A',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([row({ id: 'B' })], Date.now() + 10);
      expect(store.getOperationByListAlias('B')?.operationId).toBe('op-1');
      store.byId['op-1'].lastSeenAt = Date.now() - 5_000;
      store.seedFromContainerList([row({ id: 'B' }, null)], Date.now());
      expect(store.getOperationByListAlias('B')).toBeUndefined();
    });

    it('drops list aliases once the operation turns terminal', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'A',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([row({ id: 'B' })], Date.now() + 10);
      store.applyUpdateApplied({
        operationId: 'op-1',
        containerId: 'A',
        containerName: 'web',
        batchId: null,
        timestamp: new Date().toISOString(),
      });
      expect(store.getOperationByListAlias('B')).toBeUndefined();
    });

    it('keeps another operation alias when one operation turns terminal', () => {
      const store = useOperationStore();
      for (const [op, id] of [
        ['op-1', 'A'],
        ['op-2', 'D'],
      ]) {
        store.applyOperationChanged({
          operationId: op,
          containerId: id,
          status: 'in-progress',
          phase: 'pulling',
        });
      }
      store.seedFromContainerList(
        [row({ id: 'B' }), row({ id: 'E' }, { id: 'op-2' })],
        Date.now() + 10,
      );
      store.applyUpdateApplied({
        operationId: 'op-1',
        containerId: 'A',
        containerName: 'web',
        batchId: null,
        timestamp: new Date().toISOString(),
      });
      expect(store.getOperationByListAlias('B')).toBeUndefined();
      expect(store.getOperationByListAlias('E')?.operationId).toBe('op-2');
    });

    it('does not let a list fetched before an SSE advance rewind the phase (race guard)', () => {
      const store = useOperationStore();
      const requestStartedAt = Date.now() - 1_000;
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'health-gate',
      });
      store.seedFromContainerList(
        [row({}, { phase: 'pulling', fromVersion: '1', toVersion: '2' })],
        requestStartedAt,
      );
      expect(store.byId['op-1']).toMatchObject({
        status: 'in-progress',
        phase: 'health-gate',
        fromVersion: '1',
        toVersion: '2',
      });
      expect(store.byId['op-1'].updatedAt).not.toBe('2026-04-01T12:00:00.000Z');
    });

    it('stamps the id on an SSE operation that had none', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });
      store.seedFromContainerList([row()], Date.now());
      expect(store.byId['op-1'].containerId).toBe('c1');
    });
  });

  describe('reconcile against the list (D2)', () => {
    it('drops the per-container index entry for a stale active op the list no longer shows', async () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        batchId: 'b1',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.byId['op-1'].lastSeenAt = Date.now() - 5_000;
      store.seedFromContainerList([row({}, null)], Date.now());

      expect(store.getOperationByContainerId('c1')).toBeUndefined();
      // The operation itself, and batch counts, are untouched.
      expect(store.byId['op-1'].status).toBe('in-progress');
      expect(store.getBatchProgress('b1')?.active).toBe(1);
    });

    it('drops the identity index entry too', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row()], Date.now());
      store.byId['op-1'].lastSeenAt = Date.now() - 5_000;
      store.seedFromContainerList([row({}, null)], Date.now());
      expect(store.getOperationByIdentityKey('::local::web')).toBeUndefined();
    });

    it('keeps an op seen after the request started (race guard)', () => {
      const store = useOperationStore();
      const requestStartedAt = Date.now() - 1_000;
      store.applyOperationChanged({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([row({}, null)], requestStartedAt);
      expect(store.getOperationByContainerId('c1')?.operationId).toBe('op-1');
    });

    it('ignores rows with nothing indexed, and a terminal indexed op', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row({}, null), { name: 'x' }], Date.now());
      expect(store.byId).toEqual({});
    });

    it('does nothing for non-object rows without an operation', () => {
      const store = useOperationStore();
      store.seedFromContainerList([null], Date.now());
      expect(store.byId).toEqual({});
    });
  });

  describe('getOperationForContainer', () => {
    it('resolves by container id, shaped like the mapper output', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row({}, { fromVersion: '1', toVersion: '2' })], Date.now());
      expect(store.getOperationForContainer({ id: 'c1' })).toEqual({
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1',
        toVersion: '2',
      });
      expect(store.isContainerUpdateActive({ id: 'c1' })).toBe(true);
      expect(store.getActiveOperationStatus({ id: 'c1' })).toBe('in-progress');
    });

    it('returns nothing, inactive and no status, for an unknown container', () => {
      const store = useOperationStore();
      expect(store.getOperationForContainer({ id: 'zzz' })).toBeUndefined();
      expect(store.isContainerUpdateActive({ id: 'zzz' })).toBe(false);
      expect(store.getActiveOperationStatus({ id: 'zzz' })).toBeUndefined();
    });

    it('falls back to the identity key when the id differs', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row()], Date.now());
      expect(
        store.getOperationForContainer({ id: 'recreated', identityKey: '::local::web' })?.id,
      ).toBe('op-1');
      expect(store.getOperationForContainer({ id: 'recreated', identityKey: 'other' })).toBe(
        undefined,
      );
    });

    it('matches by name only for operations that carry no container id', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-n',
        containerName: 'named',
        status: 'queued',
      });
      store.applyOperationChanged({
        operationId: 'op-i',
        containerId: 'c9',
        containerName: 'other',
        status: 'queued',
        phase: 'queued',
      });

      const named = store.getOperationForContainer({ id: 'x', name: 'named' });
      expect(named).toMatchObject({ id: 'op-n', status: 'queued', phase: 'queued' });
      expect(named?.updatedAt).toEqual(expect.any(String));
      expect(store.getOperationForContainer({ id: 'x', name: 'other' })).toBeUndefined();
      expect(store.getOperationForContainer({ id: 'x' })).toBeUndefined();
    });

    it('falls back to the last-seen time when an operation has no updatedAt', () => {
      const store = useOperationStore();
      store.applyOperationChanged({ operationId: 'op-u', containerId: 'cu', status: 'queued' });
      store.byId['op-u'].updatedAt = undefined;
      store.byId['op-u'].lastSeenAt = Date.parse('2026-04-01T12:00:00.000Z');
      expect(store.getOperationForContainer({ id: 'cu' })?.updatedAt).toBe(
        '2026-04-01T12:00:00.000Z',
      );
    });

    it('coerces an invalid or missing phase for the status', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'op-q',
        containerId: 'cq',
        status: 'queued',
        phase: 'pulling',
      });
      store.applyOperationChanged({
        operationId: 'op-p',
        containerId: 'cp',
        status: 'in-progress',
      });
      expect(store.getOperationForContainer({ id: 'cq' })?.phase).toBe('queued');
      expect(store.getOperationForContainer({ id: 'cp' })?.phase).toBe('pulling');
    });

    it('prefers a held display operation over the store', () => {
      const store = useOperationStore();
      store.seedFromContainerList([row()], Date.now());
      const held = {
        id: 'op-held',
        status: 'in-progress' as const,
        phase: 'pulling' as const,
        updatedAt: '2026-04-01T12:10:00.000Z',
      };
      useOperationDisplayHold().holdOperationDisplay({
        operationId: 'op-held',
        operation: held,
        containerId: 'c1',
        now: Date.now(),
      });
      expect(store.getOperationForContainer({ id: 'c1' })).toEqual(held);
    });

    it('reads only the store indexes when ignoreHold is set', () => {
      const store = useOperationStore();
      const held = {
        id: 'op-held',
        status: 'in-progress' as const,
        phase: 'pulling' as const,
        updatedAt: '2026-04-01T12:10:00.000Z',
      };
      useOperationDisplayHold().holdOperationDisplay({
        operationId: 'op-held',
        operation: held,
        containerId: 'c1',
        now: Date.now(),
      });
      expect(store.isContainerUpdateActive({ id: 'c1' })).toBe(true);
      expect(store.isContainerUpdateActive({ id: 'c1' }, { ignoreHold: true })).toBe(false);

      store.seedFromContainerList([row()], Date.now());
      expect(store.getOperationForContainer({ id: 'c1' }, { ignoreHold: true })?.id).toBe('op-1');
    });
  });

  describe('prune terminal operations (D6)', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    it('removes old terminal ops outside any display batch on seed', () => {
      const store = useOperationStore();
      store.applyUpdateApplied({
        operationId: 'old',
        containerId: 'c1',
        containerName: 'web',
        batchId: null,
        timestamp: old,
      });
      store.applyUpdateApplied({
        operationId: 'fresh',
        containerId: 'c2',
        containerName: 'db',
        batchId: null,
        timestamp: new Date().toISOString(),
      });
      store.seedFromContainerList([], Date.now());
      expect(Object.keys(store.byId)).toEqual(['fresh']);
    });

    it('keeps old terminal ops that belong to a display batch, and active ops', () => {
      const store = useOperationStore();
      store.captureDisplayBatch('b1', 2);
      store.applyUpdateApplied({
        operationId: 'batched',
        containerId: 'c1',
        containerName: 'web',
        batchId: 'b1',
        timestamp: old,
      });
      store.applyOperationChanged({
        operationId: 'active',
        containerId: 'c2',
        containerName: 'db',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.pruneTerminalOperations(Date.now() + 60 * 60 * 1000);
      expect(Object.keys(store.byId).sort()).toEqual(['active', 'batched']);
    });

    it('keeps a finished batch member while a sibling is active, with distinct group key', () => {
      const store = useOperationStore();
      store.captureDisplayBatch('group-x', 2);
      store.applyUpdateApplied({
        operationId: 'done',
        containerId: 'c1',
        containerName: 'web',
        batchId: 'batch-9',
        timestamp: old,
      });
      store.applyOperationChanged({
        operationId: 'live',
        containerId: 'c2',
        containerName: 'db',
        batchId: 'batch-9',
        status: 'in-progress',
        phase: 'pulling',
      });
      store.seedFromContainerList([], Date.now());
      expect(store.getBatchProgress('batch-9')).toMatchObject({
        total: 2,
        succeeded: 1,
        active: 1,
      });
      expect(store.getActiveBatchProgress().map((b) => b.batchId)).toEqual(['batch-9']);

      store.applyUpdateApplied({
        operationId: 'live',
        containerId: 'c2',
        containerName: 'db',
        batchId: 'batch-9',
        timestamp: old,
      });
      store.pruneTerminalOperations(Date.now());
      expect(Object.keys(store.byId)).toEqual([]);
    });

    it('ages a terminal op by lastSeenAt when completedAt is unusable', () => {
      const store = useOperationStore();
      store.applyOperationChanged({
        operationId: 'no-completed',
        containerId: 'c1',
        status: 'expired',
        phase: 'expired',
      });
      store.pruneTerminalOperations(Date.now());
      expect(store.byId['no-completed']).toBeDefined();
      store.pruneTerminalOperations(Date.now() + 31 * 60 * 1000);
      expect(store.byId['no-completed']).toBeUndefined();
    });
  });

  describe('seedOperation helper', () => {
    it('seeds active ops through the list path and terminal ops through events', () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useOperationStore(pinia);
      const active = seedOperation(
        pinia,
        { id: 'a', name: 'a', identityKey: 'k-a' },
        {
          fromVersion: '1',
          toVersion: '2',
        },
      );
      expect(active).toMatchObject({ containerId: 'a', identityKey: 'k-a', fromVersion: '1' });
      expect(store.getOperationForContainer({ id: 'zz', identityKey: 'k-a' })?.id).toBe('op-a');

      const queued = seedOperation(pinia, { id: 'q', name: 'q' }, { status: 'queued' });
      expect(queued.phase).toBe('queued');

      const done = seedOperation(
        pinia,
        { id: 'd', name: 'd' },
        {
          status: 'succeeded',
          operationId: 'op-done',
        },
      );
      expect(done.status).toBe('succeeded');
      expect(store.getOperationForContainer({ id: 'd' })).toBeUndefined();
    });
  });

  describe('parity with the mapper-derived updateOperation', () => {
    const fixtures: Array<[string, Record<string, unknown>]> = [
      [
        'minimal in-progress',
        { id: 'op-1', status: 'in-progress', phase: 'pulling', updatedAt: 't' },
      ],
      ['queued', { id: 'op-2', status: 'queued', phase: 'queued', updatedAt: 't' }],
      [
        'with versions',
        {
          id: 'op-3',
          status: 'in-progress',
          phase: 'old-stopped',
          updatedAt: 't',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
        },
      ],
      [
        'with a valid batch',
        {
          id: 'op-4',
          status: 'queued',
          phase: 'queued',
          updatedAt: 't',
          batchId: 'b',
          queuePosition: 2,
          queueTotal: 4,
        },
      ],
      [
        'with an inconsistent batch',
        {
          id: 'op-5',
          status: 'in-progress',
          phase: 'pulling',
          updatedAt: 't',
          batchId: 'b',
          queuePosition: 9,
          queueTotal: 4,
        },
      ],
      ['terminal status', { id: 'op-6', status: 'succeeded', phase: 'succeeded', updatedAt: 't' }],
      [
        'phase invalid for status',
        { id: 'op-7', status: 'queued', phase: 'pulling', updatedAt: 't' },
      ],
      ['missing updatedAt', { id: 'op-8', status: 'in-progress', phase: 'pulling' }],
      ['missing id', { status: 'in-progress', phase: 'pulling', updatedAt: 't' }],
    ];

    it.each(fixtures)('%s', (_label, updateOperation) => {
      const apiRow = {
        id: 'c1',
        name: 'web',
        displayName: '',
        status: 'running',
        watcher: 'local',
        agent: null,
        image: { registry: { name: 'hub', url: 'u' }, name: 'nginx', tag: { value: '1.0' } },
        result: null,
        updateAvailable: true,
        updateKind: null,
        security: null,
        labels: null,
        displayIcon: '',
        updateOperation,
      };
      const mapped = mapApiContainer(apiRow as never);
      const store = useOperationStore();
      store.seedFromContainerList([apiRow], Date.now());

      const fromStore = store.getOperationForContainer({
        id: mapped.id,
        identityKey: mapped.identityKey,
        name: mapped.name,
      });
      // kind and targetImage have no readers and are intentionally not carried.
      const { kind: _kind, targetImage: _targetImage, ...expected } = mapped.updateOperation ?? {};
      expect(fromStore).toEqual(mapped.updateOperation ? expected : undefined);
    });
  });
});
