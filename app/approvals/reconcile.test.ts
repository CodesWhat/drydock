/**
 * Tests for the approval reconciler (spec-ca-2-approval-queue.md, slice 2).
 *
 * Driven through the real event bus and a real LokiJS store, so the wiring is exercised
 * rather than described. The trigger registry, the global update mode and self-update
 * availability are the only doubles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Loki from 'lokijs';
import * as events from '../event/index.js';
import {
  clearAllListenersForTests,
  emitContainerRemoved,
  emitContainerReport,
  emitContainerReports,
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
} from '../event/index.js';
import type { ActionPolicyTrigger } from '../model/action-policy.js';
import type { Container } from '../model/container.js';
import * as approvalStore from '../store/approval.js';
import * as reconcile from './reconcile.js';

const { getStateMock, getUpdateModeMock, isSelfUpdateAvailableMock, warnMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  getUpdateModeMock: vi.fn(),
  isSelfUpdateAvailableMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('../registry/index.js', () => ({ getState: getStateMock }));
vi.mock('../store/settings.js', () => ({ getUpdateMode: getUpdateModeMock }));
vi.mock('../triggers/providers/docker/self-update-availability.js', () => ({
  isSelfUpdateAvailable: isSelfUpdateAvailableMock,
}));
vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: warnMock, debug: vi.fn(), error: vi.fn() }),
  },
}));

function createTrigger(
  auto: 'all' | 'none' | 'onauto' = 'none',
  id = 'docker.local',
): Record<string, ActionPolicyTrigger> {
  return {
    [id]: {
      type: 'docker',
      configuration: { auto },
      getId: () => id,
    } as unknown as ActionPolicyTrigger,
  };
}

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'nginx',
    displayName: 'nginx',
    displayIcon: 'icon',
    status: 'running',
    watcher: 'local',
    image: {
      id: 'image-1',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'library/nginx',
      tag: { value: '1.2.3', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.2.4' },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.2.3',
      remoteValue: '1.2.4',
      semverDiff: 'patch',
    },
    ...overrides,
  } as Container;
}

function allRows() {
  return approvalStore.listApprovals({ status: 'all' }).records;
}

beforeEach(() => {
  approvalStore.createCollections(new Loki('reconcile-test.db'));
  getStateMock.mockReturnValue({ trigger: createTrigger('none') });
  getUpdateModeMock.mockReturnValue('manual');
  isSelfUpdateAvailableMock.mockReturnValue(true);
  reconcile.init();
});

afterEach(() => {
  reconcile.deregisterForTests();
  approvalStore.resetApprovalStoreForTests();
  clearAllListenersForTests();
  vi.clearAllMocks();
});

describe('init', () => {
  test('is idempotent, so a row is created once per report and not once per call', async () => {
    reconcile.init();
    reconcile.init();

    await emitContainerReport({ container: createContainer(), changed: true });

    expect(allRows()).toHaveLength(1);
  });

  test('deregisters its listeners', async () => {
    reconcile.deregisterForTests();

    await emitContainerReport({ container: createContainer(), changed: true });

    expect(allRows()).toHaveLength(0);
  });
});

describe('reconcileContainer', () => {
  test('inserts a pending row on first sighting', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    expect(allRows()).toMatchObject([
      {
        containerId: 'container-1',
        containerName: 'nginx',
        candidateRef: '1.2.4',
        fromRef: '1.2.3',
        toRef: '1.2.4',
        decision: 'pending',
      },
    ]);
  });

  test('is idempotent across watch cycles', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    await emitContainerReport({ container: createContainer(), changed: false });
    await emitContainerReport({ container: createContainer(), changed: false });

    expect(allRows()).toHaveLength(1);
  });

  test('reconciles every container in a bulk report', async () => {
    await emitContainerReports([
      { container: createContainer(), changed: true },
      {
        container: createContainer({ id: 'container-2', name: 'redis' }),
        changed: true,
      },
    ]);

    expect(allRows()).toHaveLength(2);
  });

  test('creates no row for a container with no raw update', async () => {
    const container = createContainer({
      result: { tag: '1.2.3' },
      updateKind: { kind: 'unknown' },
    });

    await emitContainerReport({ container, changed: false });

    expect(allRows()).toHaveLength(0);
  });

  // Spec edge case 8.
  test('creates no row for a hard-blocked container', async () => {
    getStateMock.mockReturnValue({ trigger: createTrigger('onauto') });

    await emitContainerReport({ container: createContainer(), changed: true });

    expect(allRows()).toHaveLength(0);
  });

  // Spec edge case 9.
  test('creates a row for a soft-blocked container', async () => {
    const container = createContainer({
      updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' },
    });

    await emitContainerReport({ container, changed: false });

    expect(allRows()).toHaveLength(1);
  });

  // Spec edge case 13.
  test('honours the self-update-unavailable hard blocker', async () => {
    isSelfUpdateAvailableMock.mockReturnValue(false);
    const container = createContainer({
      image: { ...createContainer().image, name: 'codeswhat/drydock' },
    });

    await emitContainerReport({ container, changed: true });

    expect(allRows()).toHaveLength(0);
  });

  test('ignores a report with no container id', async () => {
    await emitContainerReport({
      container: createContainer({ id: '' }),
      changed: true,
    });

    expect(allRows()).toHaveLength(0);
  });

  test('ignores a report with no container at all', async () => {
    await emitContainerReport({ changed: true } as never);

    expect(allRows()).toHaveLength(0);
  });

  test('creates no row when the candidate carries neither a tag nor a digest', async () => {
    const container = createContainer({
      image: { ...createContainer().image, created: '2026-01-01T00:00:00.000Z' },
      result: { created: '2026-02-01T00:00:00.000Z' },
      updateKind: { kind: 'unknown' },
    });

    await emitContainerReport({ container, changed: true });

    expect(allRows()).toHaveLength(0);
  });

  // Spec edge case 10 (the #411 class of bug).
  test('same-named containers on two agents get independent rows', async () => {
    const first = createContainer({ id: 'c-a', agent: 'edge-1' });
    const second = createContainer({ id: 'c-b', agent: 'edge-2' });

    getStateMock.mockReturnValue({
      trigger: {
        'edge-1.docker.local': {
          type: 'docker',
          agent: 'edge-1',
          configuration: { auto: 'none' },
          getId: () => 'edge-1.docker.local',
        } as unknown as ActionPolicyTrigger,
        'edge-2.docker.local': {
          type: 'docker',
          agent: 'edge-2',
          configuration: { auto: 'none' },
          getId: () => 'edge-2.docker.local',
        } as unknown as ActionPolicyTrigger,
      },
    });

    await emitContainerReports([
      { container: first, changed: true },
      { container: second, changed: true },
    ]);

    expect(
      allRows()
        .map((row) => row.containerIdentityKey)
        .sort(),
    ).toStrictEqual(['edge-1::local::nginx', 'edge-2::local::nginx']);
  });
});

// Spec edge case 1.
describe('supersession', () => {
  test('a newer candidate supersedes the pending row and leaves the count at one', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: {
          kind: 'tag',
          localValue: '1.2.3',
          remoteValue: '1.2.5',
          semverDiff: 'patch',
        },
      }),
      changed: true,
    });

    const rows = allRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.candidateRef === '1.2.4')).toMatchObject({
      resolution: 'superseded',
    });
    const queued = rows.find((row) => row.candidateRef === '1.2.5');
    expect(queued).toMatchObject({ decision: 'pending' });
    expect(queued?.resolvedAt).toBeUndefined();
    expect(approvalStore.countApprovals().pending).toBe(1);
  });

  test('supersedes a stale row even when the newer candidate is itself hard-blocked', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    getStateMock.mockReturnValue({ trigger: createTrigger('onauto') });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.5' },
      }),
      changed: true,
    });

    expect(allRows()).toMatchObject([{ candidateRef: '1.2.4', resolution: 'superseded' }]);
    expect(approvalStore.countApprovals().pending).toBe(0);
  });

  test('supersedes a deferred row, because the deferral is on a candidate that is gone', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    const [row] = allRows();
    approvalStore.updateApproval(row.id, {
      decision: 'deferred',
      deferredUntil: '2999-01-01T00:00:00.000Z',
    });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.5' },
      }),
      changed: true,
    });

    expect(allRows().find((candidate) => candidate.id === row.id)).toMatchObject({
      resolution: 'superseded',
    });
    expect(approvalStore.countApprovals().deferred).toBe(0);
  });

  test('leaves a decided row alone, because the operator already answered for it', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    const [row] = allRows();
    approvalStore.updateApproval(row.id, {
      decision: 'rejected',
      decidedAt: '2026-01-01T00:00:00.000Z',
      decidedBy: 'scott',
    });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.5' },
      }),
      changed: true,
    });

    const rejected = allRows().find((candidate) => candidate.id === row.id);
    expect(rejected).toMatchObject({ decision: 'rejected' });
    expect(rejected?.resolution).toBeUndefined();
    expect(approvalStore.countApprovals().pending).toBe(1);
  });

  test('does not supersede a row that was already resolved', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    const [row] = allRows();
    approvalStore.updateApproval(row.id, {
      resolution: 'container-removed',
      resolvedAt: '2026-01-01T00:00:00.000Z',
    });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.5' },
      }),
      changed: true,
    });

    expect(allRows().find((candidate) => candidate.id === row.id)).toMatchObject({
      resolution: 'container-removed',
      resolvedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('candidate withdrawal', () => {
  test('marks a pending row withdrawn once the candidate disappears', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.3' },
        updateKind: { kind: 'unknown' },
      }),
      changed: true,
    });

    expect(allRows()).toMatchObject([{ resolution: 'candidate-withdrawn' }]);
    expect(approvalStore.countApprovals().pending).toBe(0);
  });

  test('leaves a row pending when the candidate stands but a hard blocker appeared', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    getStateMock.mockReturnValue({ trigger: createTrigger('onauto') });

    await emitContainerReport({ container: createContainer(), changed: false });

    const [row] = allRows();
    expect(allRows()).toHaveLength(1);
    expect(row).toMatchObject({ decision: 'pending' });
    expect(row.resolution).toBeUndefined();
  });
});

// Spec edge case 2.
describe('container removal', () => {
  test('resolves every open row for the removed container', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    emitContainerRemoved({ id: 'container-1' });

    expect(allRows()).toMatchObject([{ resolution: 'container-removed' }]);
    expect(approvalStore.countApprovals().pending).toBe(0);
  });

  test('leaves other containers alone', async () => {
    await emitContainerReports([
      { container: createContainer(), changed: true },
      { container: createContainer({ id: 'container-2' }), changed: true },
    ]);

    emitContainerRemoved({ id: 'container-1' });

    expect(approvalStore.countApprovals().pending).toBe(1);
  });

  test('ignores a removal payload with no id', () => {
    expect(() => emitContainerRemoved({})).not.toThrow();
  });
});

// Spec edge cases 6 and 7 — the mode-flip pair that falsifies the predicate cheaply.
describe('update-mode flips', () => {
  test('auto to manual queues the previously auto-dispatched candidate, without duplicating', async () => {
    getUpdateModeMock.mockReturnValue('auto');
    getStateMock.mockReturnValue({ trigger: createTrigger('all') });

    await emitContainerReport({ container: createContainer(), changed: true });
    expect(allRows()).toHaveLength(0);

    getUpdateModeMock.mockReturnValue('manual');
    await emitContainerReport({ container: createContainer(), changed: false });
    await emitContainerReport({ container: createContainer(), changed: false });

    expect(allRows()).toHaveLength(1);
    expect(approvalStore.countApprovals().pending).toBe(1);
  });

  test('manual to auto resolves the orphaned row as auto-applied by the system', async () => {
    getStateMock.mockReturnValue({ trigger: createTrigger('all') });
    await emitContainerReport({ container: createContainer(), changed: true });
    expect(approvalStore.countApprovals().pending).toBe(1);

    getUpdateModeMock.mockReturnValue('auto');
    await emitContainerReport({ container: createContainer(), changed: false });

    expect(allRows()).toMatchObject([{ resolution: 'auto-applied', decidedBy: 'system' }]);
    expect(approvalStore.countApprovals().pending).toBe(0);
  });

  test('a manual-resolved container keeps its row when the mode flips to auto', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    getUpdateModeMock.mockReturnValue('auto');
    await emitContainerReport({ container: createContainer(), changed: false });

    const [row] = allRows();
    expect(allRows()).toHaveLength(1);
    expect(row).toMatchObject({ decision: 'pending' });
    expect(row.resolution).toBeUndefined();
  });
});

// Spec edge case 3.
describe('operation outcomes', () => {
  function seedApprovedRow(operationId = 'op-1'): string {
    const record = approvalStore.insertApproval({
      containerId: 'container-1',
      containerIdentityKey: '::local::nginx',
      containerName: 'nginx',
      watcher: 'local',
      image: 'library/nginx',
      fromRef: '1.2.3',
      toRef: '1.2.4',
      candidateRef: '1.2.4',
      updateKind: 'tag',
      semverDiff: 'patch',
    });
    approvalStore.updateApproval(record.id, {
      decision: 'approved',
      decidedAt: '2026-01-01T00:00:00.000Z',
      operationId,
    });
    return record.id;
  }

  test('stamps applied on the row carrying the operation id', async () => {
    const id = seedApprovedRow();

    await emitContainerUpdateApplied({ containerName: 'nginx', operationId: 'op-1' });

    expect(approvalStore.getApprovalById(id)?.outcome).toBe('applied');
  });

  test('stamps rolled-back when the failure carries a rollback reason', async () => {
    const id = seedApprovedRow();

    await emitContainerUpdateFailed({
      containerName: 'nginx',
      error: 'health gate failed',
      operationId: 'op-1',
      rollbackReason: 'health-gate',
    });

    expect(approvalStore.getApprovalById(id)?.outcome).toBe('rolled-back');
  });

  test('stamps failed when the failure carries no rollback reason', async () => {
    const id = seedApprovedRow();

    await emitContainerUpdateFailed({
      containerName: 'nginx',
      error: 'pull failed',
      operationId: 'op-1',
    });

    expect(approvalStore.getApprovalById(id)?.outcome).toBe('failed');
  });

  test('ignores a legacy string applied payload, which carries no operation id', async () => {
    const id = seedApprovedRow();

    await emitContainerUpdateApplied('nginx');

    expect(approvalStore.getApprovalById(id)?.outcome).toBeUndefined();
  });

  test('ignores an applied payload with no operation id', async () => {
    const id = seedApprovedRow();

    await emitContainerUpdateApplied({ containerName: 'nginx' });

    expect(approvalStore.getApprovalById(id)?.outcome).toBeUndefined();
  });

  test('ignores an operation id no row carries', async () => {
    const id = seedApprovedRow('op-1');

    await emitContainerUpdateApplied({ containerName: 'nginx', operationId: 'op-2' });

    expect(approvalStore.getApprovalById(id)?.outcome).toBeUndefined();
  });
});

describe('failure isolation', () => {
  test('a store failure never breaks the watch cycle', async () => {
    const insertSpy = vi.spyOn(approvalStore, 'insertApproval').mockImplementation(() => {
      throw new Error('collection gone');
    });

    try {
      await expect(
        emitContainerReport({ container: createContainer(), changed: true }),
      ).resolves.toBeUndefined();
    } finally {
      insertSpy.mockRestore();
    }

    expect(warnMock).toHaveBeenCalledWith('Approval reconciliation failed: collection gone');
  });

  test('a rejected event dispatch is logged rather than left unhandled', async () => {
    const emitSpy = vi
      .spyOn(events, 'emitApprovalEvent')
      .mockRejectedValue(new Error('bus is down'));

    try {
      await emitContainerReport({ container: createContainer(), changed: true });
      await vi.waitFor(() =>
        expect(warnMock).toHaveBeenCalledWith('Approval event dispatch failed: bus is down'),
      );
    } finally {
      emitSpy.mockRestore();
    }

    expect(allRows()).toHaveLength(1);
  });
});

// Spec edge case 14 / the DR-4 lesson.
describe('queue-change events', () => {
  function approvalEvents() {
    return vi
      .mocked(events.emitApprovalEvent)
      .mock.calls.map(([payload]: [events.ApprovalEventPayload]) => payload);
  }

  beforeEach(() => {
    vi.spyOn(events, 'emitApprovalEvent');
  });

  afterEach(() => {
    vi.mocked(events.emitApprovalEvent).mockRestore();
  });

  test('announces a created row with five scalars and no container payload', async () => {
    await emitContainerReport({
      container: createContainer({
        security: {
          updateScan: {
            status: 'passed',
            image: 'library/nginx:1.2.4',
            scannedAt: '2026-01-01T00:00:00.000Z',
            summary: { critical: 1, high: 2, medium: 3, low: 4, unknown: 5 },
            vulnerabilities: Array.from({ length: 500 }, (_unused, index) => ({
              id: `CVE-2026-${index}`,
              severity: 'HIGH',
            })),
          },
        },
      } as unknown as Partial<Container>),
      changed: true,
    });

    const [payload] = approvalEvents();
    expect(Object.keys(payload).sort()).toStrictEqual([
      'containerId',
      'containerName',
      'decision',
      'id',
      'kind',
      'pendingCount',
    ]);
    expect(payload).toMatchObject({
      kind: 'created',
      containerId: 'container-1',
      containerName: 'nginx',
      decision: 'pending',
      pendingCount: 1,
    });
    expect(JSON.stringify(payload).length).toBeLessThan(256 * 1024);
  });

  test('announces a resolved row with the count it leaves behind', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });

    emitContainerRemoved({ id: 'container-1' });

    expect(approvalEvents().map((payload) => [payload.kind, payload.pendingCount])).toStrictEqual([
      ['created', 1],
      ['resolved', 0],
    ]);
  });

  test('announces one resolved event per row a supersession retires', async () => {
    await emitContainerReport({ container: createContainer(), changed: true });
    await emitContainerReport({
      container: createContainer({
        result: { tag: '1.2.5' },
        updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.5' },
      }),
      changed: true,
    });

    expect(approvalEvents().map((payload) => payload.kind)).toStrictEqual([
      'created',
      'resolved',
      'created',
    ]);
  });
});

// Spec edge case 12 / the DR-8 agent-mode invariant.
describe('the ledger is controller-owned', () => {
  test('no module under app/agent reaches the approval store or the reconciler', () => {
    const agentDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../agent');
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        if (!entry.name.endsWith('.ts')) {
          continue;
        }
        const source = fs.readFileSync(entryPath, 'utf-8');
        if (source.includes('store/approval') || source.includes('approvals/reconcile')) {
          offenders.push(entryPath);
        }
      }
    };

    walk(agentDirectory);

    expect(offenders).toStrictEqual([]);
  });

  test('an ingest the ownership gate dropped mints nothing, because it emits no report', async () => {
    // `canIngestAuthoritativeContainer` returns false for a foreign id, so
    // `processAuthoritativeContainers` pushes nothing and emits an empty batch. That
    // empty batch is the only thing the ledger ever sees from a rejected sync frame.
    await emitContainerReports([]);

    expect(allRows()).toHaveLength(0);
  });
});
