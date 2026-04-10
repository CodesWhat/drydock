import {
  formatContainersAlreadyUpToDateMessage,
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

  it('uses the plural already-up-to-date label for multiple containers', () => {
    expect(formatContainersAlreadyUpToDateMessage(2)).toBe('2 containers already up to date');
  });
});
