import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockInsertAudit, mockInc, mockGetAuditCounter } = vi.hoisted(() => ({
  mockInsertAudit: vi.fn(),
  mockInc: vi.fn(),
  mockGetAuditCounter: vi.fn(),
}));

vi.mock('../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

async function loadEventModule() {
  vi.resetModules();
  return import('./index.js');
}

describe('event default audit listeners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuditCounter.mockReturnValue({ inc: mockInc });
  });

  test('should emit self-update-starting event', async () => {
    const event = await loadEventModule();
    const handler = vi.fn();
    event.registerSelfUpdateStarting(handler);

    event.emitSelfUpdateStarting();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('should record update-available audits when container report has update', async () => {
    const event = await loadEventModule();

    await event.emitContainerReport({
      container: {
        name: 'nginx',
        updateAvailable: true,
        image: { name: 'library/nginx' },
        updateKind: { localValue: '1.24', remoteValue: '1.25' },
      },
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-available',
        containerName: 'nginx',
        containerImage: 'library/nginx',
        fromVersion: '1.24',
        toVersion: '1.25',
        status: 'info',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'update-available' });
  });

  test('should skip update-available audit when no update exists', async () => {
    const event = await loadEventModule();

    await event.emitContainerReport({
      container: {
        name: 'nginx',
        updateAvailable: false,
      },
    });

    expect(mockInsertAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-available',
      }),
    );
  });

  test('should record container added and removed audits with fallback names', async () => {
    const event = await loadEventModule();

    event.emitContainerAdded({ name: 'web', image: { name: 'app/web' } });
    event.emitContainerAdded({ id: 'container-id-only', image: { name: 'app/id' } });
    event.emitContainerRemoved({ id: 'removed-id', image: { name: 'app/removed' } });
    event.emitContainerRemoved({});

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-added',
        containerName: 'web',
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-added',
        containerName: 'container-id-only',
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-removed',
        containerName: 'removed-id',
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'container-removed',
        containerName: '',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'container-added' });
    expect(mockInc).toHaveBeenCalledWith({ action: 'container-removed' });
  });

  test('should record security-alert audits', async () => {
    const event = await loadEventModule();

    await event.emitSecurityAlert({
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 3,
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security-alert',
        containerName: 'docker_local_nginx',
        status: 'error',
        details: 'critical=1, high=2; blocking=3',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'security-alert' });
  });

  test('should omit blocking suffix when security alert blockingCount is not positive', async () => {
    const event = await loadEventModule();

    await event.emitSecurityAlert({
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 0,
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security-alert',
        details: 'critical=1, high=2',
      }),
    );
  });

  test('should deduplicate repeated security-alert audits within the dedupe window', async () => {
    const event = await loadEventModule();

    await event.emitSecurityAlert({
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 3,
    });
    await event.emitSecurityAlert({
      containerName: 'docker_local_nginx',
      details: 'critical=1, high=2',
      blockingCount: 3,
    });

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledWith({ action: 'security-alert' });
  });

  test('should record agent-disconnect audits', async () => {
    const event = await loadEventModule();

    await event.emitAgentDisconnected({
      agentName: 'edge-a',
      reason: 'SSE connection lost',
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent-disconnect',
        containerName: 'edge-a',
        status: 'error',
        details: 'SSE connection lost',
      }),
    );
    expect(mockInc).toHaveBeenCalledWith({ action: 'agent-disconnect' });
  });

  test('should record agent-disconnect audits without a reason', async () => {
    const event = await loadEventModule();

    await event.emitAgentDisconnected({
      agentName: 'edge-b',
    });

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent-disconnect',
        containerName: 'edge-b',
        details: undefined,
      }),
    );
  });

  test('should deduplicate repeated agent-disconnect audits within the dedupe window', async () => {
    const event = await loadEventModule();

    await event.emitAgentDisconnected({
      agentName: 'edge-a',
      reason: 'SSE connection lost',
    });
    await event.emitAgentDisconnected({
      agentName: 'edge-a',
      reason: 'SSE connection lost',
    });

    expect(mockInsertAudit).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledTimes(1);
    expect(mockInc).toHaveBeenCalledWith({ action: 'agent-disconnect' });
  });

  test('should prune stale audit dedupe cache entries', async () => {
    const event = await loadEventModule();
    const cache = new Map<string, number>([
      ['stale', 0],
      ['recent', 10 * 60 * 1000 + 1],
    ]);

    event.pruneAuditDedupeCacheForTests(cache, 10 * 60 * 1000 + 1, 5 * 60 * 1000);

    expect(cache.has('stale')).toBe(false);
    expect(cache.has('recent')).toBe(true);
  });
});
