import {
  formatContainersAlreadyUpToDateMessage,
  getUpdateInProgressPhaseLabelKey,
  shouldRenderStandaloneQueuedUpdateAsUpdating,
} from '@/utils/container-update';

describe('container-update utils', () => {
  it('yields standalone queued updates to persisted queued batch heads', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: undefined,
        },
        containers: [
          {
            id: 'batched',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:00.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: undefined,
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('prefers the earliest queued position within a persisted batch', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
        },
        containers: [
          {
            id: 'queued-tail',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:00.000Z',
              batchId: 'batch-1',
              queuePosition: 2,
              queueTotal: 2,
            },
          },
          {
            id: 'queued-head',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:01.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('keeps the existing persisted batch head when a later queued item is seen', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
        },
        containers: [
          {
            id: 'queued-head',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:00.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'queued-tail',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:01.000Z',
              batchId: 'batch-1',
              queuePosition: 2,
              queueTotal: 2,
            },
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('uses the singular already-up-to-date label for one container', () => {
    expect(formatContainersAlreadyUpToDateMessage(1)).toBe('1 container already up to date');
  });

  it('treats invalid queued timestamps as the newest standalone item', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'stale-timestamp',
        operation: {
          status: 'queued',
          updatedAt: 'not-a-date',
        },
        containers: [
          {
            id: 'older',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:00.000Z',
            },
          },
          {
            id: 'stale-timestamp',
            updateOperation: {
              status: 'queued',
              updatedAt: 'not-a-date',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('yields standalone queued updates to external active heads', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        hasExternalActiveHead: true,
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
        },
        containers: [
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('treats invalid persisted queue metadata as standalone queued state', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'malformed',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
          batchId: 'batch-1',
          queuePosition: 1,
          queueTotal: 0,
        },
        containers: [
          {
            id: 'malformed',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 0,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('yields to in-progress batch heads without a matching queued head', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
        },
        containers: [
          {
            id: 'in-progress-head',
            updateOperation: {
              status: 'in-progress',
              updatedAt: '2026-04-01T12:00:00.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('yields when a separate in-progress batch head is present alongside queued batch heads', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:02.000Z',
        },
        containers: [
          {
            id: 'queued-head',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:00.000Z',
              batchId: 'batch-1',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'in-progress-head',
            updateOperation: {
              status: 'in-progress',
              updatedAt: '2026-04-01T12:00:01.000Z',
              batchId: 'batch-2',
              queuePosition: 1,
              queueTotal: 2,
            },
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:02.000Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('skips non-standalone containers when scanning for the queue head', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'standalone',
        operation: {
          status: 'queued',
          updatedAt: '2026-04-01T12:00:01.000Z',
        },
        containers: [
          {
            id: 'up-to-date',
            updateOperation: undefined,
          },
          {
            id: 'standalone',
            updateOperation: {
              status: 'queued',
              updatedAt: '2026-04-01T12:00:01.000Z',
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('promotes the sole standalone queued update even with undefined updatedAt', () => {
    expect(
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        targetId: 'solo',
        operation: {
          status: 'queued',
          updatedAt: undefined,
        },
        containers: [
          {
            id: 'solo',
            updateOperation: {
              status: 'queued',
              updatedAt: undefined,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('uses the plural already-up-to-date label for multiple containers', () => {
    expect(formatContainersAlreadyUpToDateMessage(2)).toBe('2 containers already up to date');
  });
});

describe('getUpdateInProgressPhaseLabelKey', () => {
  it('maps signature-verifying to verifyingSignature', () => {
    expect(getUpdateInProgressPhaseLabelKey('signature-verifying')).toBe('verifyingSignature');
  });

  it('maps pulling to pulling', () => {
    expect(getUpdateInProgressPhaseLabelKey('pulling')).toBe('pulling');
  });

  it('maps scanning to scanning', () => {
    expect(getUpdateInProgressPhaseLabelKey('scanning')).toBe('scanning');
  });

  it('maps sbom-generating to generatingSbom', () => {
    expect(getUpdateInProgressPhaseLabelKey('sbom-generating')).toBe('generatingSbom');
  });

  it('maps health-gate to healthChecking', () => {
    expect(getUpdateInProgressPhaseLabelKey('health-gate')).toBe('healthChecking');
  });

  it('maps rollback-started to rollingBack', () => {
    expect(getUpdateInProgressPhaseLabelKey('rollback-started')).toBe('rollingBack');
  });

  it('maps rollback-deferred to rollingBack', () => {
    expect(getUpdateInProgressPhaseLabelKey('rollback-deferred')).toBe('rollingBack');
  });

  it('maps prepare to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('prepare')).toBe('updating');
  });

  it('maps renamed to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('renamed')).toBe('updating');
  });

  it('maps new-created to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('new-created')).toBe('updating');
  });

  it('maps old-stopped to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('old-stopped')).toBe('updating');
  });

  it('maps new-started to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('new-started')).toBe('updating');
  });

  it('maps health-gate-passed to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('health-gate-passed')).toBe('updating');
  });

  it('maps undefined to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey(undefined)).toBe('updating');
  });

  it('maps an unknown phase string to updating (fallback)', () => {
    expect(getUpdateInProgressPhaseLabelKey('some-future-phase')).toBe('updating');
  });
});
