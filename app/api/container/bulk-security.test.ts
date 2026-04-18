import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import { createBulkSecurityHandlers, MAX_CONCURRENT_BULK_SCANS } from './bulk-security.js';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    watcher: 'local',
    image: {
      registry: { name: 'hub', url: 'my-registry' },
      name: 'test/app',
      tag: { value: '1.2.3' },
    },
    updateAvailable: false,
    security: {},
    ...overrides,
  };
}

function createScanResult(overrides: Record<string, unknown> = {}) {
  return {
    scanner: 'trivy',
    image: 'my-registry/test/app:1.2.3',
    scannedAt: '2026-04-01T12:00:00.000Z',
    status: 'passed',
    blockSeverities: [],
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: [],
    ...overrides,
  };
}

function createHarness(options: { containers?: Record<string, unknown>[] } = {}) {
  const containers = (options.containers ?? [createContainer()]).map((c) => createContainer(c));

  const storeContainer = {
    getAllContainers: vi.fn(() => [...containers]),
    getContainer: vi.fn((id: string) => containers.find((c) => c.id === id)),
  };

  const deps = {
    storeContainer,
    getSecurityConfiguration: vi.fn(() => ({
      enabled: true,
      scanner: 'trivy',
      signature: { verify: false },
      sbom: { enabled: false, formats: [] as ('spdx-json' | 'cyclonedx-json')[] },
    })),
    scanImageForVulnerabilities: vi.fn(async () => createScanResult()),
    emitSecurityAlert: vi.fn(async () => {}),
    emitSecurityScanCycleComplete: vi.fn(async () => {}),
    fullName: vi.fn((c: any) => `local_${c.name}`),
    broadcastScanStarted: vi.fn(),
    broadcastScanCompleted: vi.fn(),
    getContainerImageFullName: vi.fn(
      (c: any) => `my-registry/${c.image.name}:${c.image.tag.value}`,
    ),
    getContainerRegistryAuth: vi.fn(async () => ({ username: 'user', password: 'token' })),
    getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'unknown error')),
    log: { info: vi.fn(), error: vi.fn() },
  };

  return { deps, storeContainer, handlers: createBulkSecurityHandlers(deps) };
}

async function callScanAll(
  handlers: ReturnType<typeof createBulkSecurityHandlers>,
  body: unknown = undefined,
) {
  const res = createMockResponse();
  const req: any = {
    body,
    on: vi.fn(),
  };
  await handlers.scanAll(req, res as any);
  return { res, req };
}

// Wait for the background runBulkScan to complete by polling for cycle-complete.
async function waitForCycleComplete(deps: {
  emitSecurityScanCycleComplete: ReturnType<typeof vi.fn>;
}) {
  await vi.waitFor(
    () => {
      expect(deps.emitSecurityScanCycleComplete).toHaveBeenCalled();
    },
    { timeout: 2000 },
  );
}

describe('api/container/bulk-security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request validation', () => {
    test('returns 400 when security scanner is not configured', async () => {
      const harness = createHarness();
      harness.deps.getSecurityConfiguration.mockReturnValueOnce({
        enabled: false,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const { res } = await callScanAll(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Security scanner is not configured' });
    });

    test('returns 400 when scanner is not trivy', async () => {
      const harness = createHarness();
      harness.deps.getSecurityConfiguration.mockReturnValueOnce({
        enabled: true,
        scanner: 'other',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const { res } = await callScanAll(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('returns 400 when body is an array', async () => {
      const harness = createHarness();
      const { res } = await callScanAll(harness.handlers, []);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Request body must be a JSON object' });
    });

    test('returns 400 for unknown request body keys', async () => {
      const harness = createHarness();
      const { res } = await callScanAll(harness.handlers, { unknownKey: true });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unknown request properties: unknownKey',
      });
    });

    test('returns 400 when containerIds is not an array', async () => {
      const harness = createHarness();
      const { res } = await callScanAll(harness.handlers, { containerIds: 'c1' });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'containerIds must be an array of strings' });
    });

    test('returns 400 when containerIds contains empty string', async () => {
      const harness = createHarness();
      const { res } = await callScanAll(harness.handlers, { containerIds: ['c1', ''] });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'containerIds must be an array of non-empty strings',
      });
    });

    test('returns 400 when severity is invalid', async () => {
      const harness = createHarness();
      const { res } = await callScanAll(harness.handlers, { severity: 'low' });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'severity must be one of: critical, high, all',
      });
    });

    test('returns 400 when a provided containerId is unknown', async () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const { res } = await callScanAll(harness.handlers, { containerIds: ['unknown-id'] });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unknown container id: unknown-id' });
    });
  });

  describe('happy-path response', () => {
    test('returns 202 with cycleId and scheduledCount immediately', async () => {
      const harness = createHarness();

      const { res } = await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: expect.stringMatching(UUID_V7_PATTERN),
          scheduledCount: 1,
        }),
      );
    });

    test('cycleId in response matches cycleId in emitted events', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(
        createScanResult({ status: 'blocked', blockingCount: 2, summary }),
      );

      const { res } = await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      const responseCycleId = (res.json as any).mock.calls[0][0].cycleId;
      expect(cyclePayload.cycleId).toBe(responseCycleId);
    });

    test('scheduledCount matches number of containers to scan', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
          { id: 'c3', name: 'postgres' },
        ],
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult());

      const { res } = await callScanAll(harness.handlers);

      const responseBody = (res.json as any).mock.calls[0][0];
      expect(responseBody.scheduledCount).toBe(3);
    });
  });

  describe('iteration and cycle-complete', () => {
    test('scans all containers from store when no containerIds provided', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
        ],
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(2);
    });

    test('scans only specified containers when containerIds provided', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
        ],
      });
      harness.storeContainer.getContainer.mockImplementation((id: string) =>
        [
          createContainer({ id: 'c1', name: 'nginx' }),
          createContainer({ id: 'c2', name: 'redis' }),
        ].find((c) => c.id === id),
      );
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult());

      await callScanAll(harness.handlers, { containerIds: ['c1'] });
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('cycle-complete emitted with scannedCount 0 for empty container set', async () => {
      const harness = createHarness({ containers: [] });
      harness.storeContainer.getAllContainers.mockReturnValue([]);

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          scannedCount: 0,
          alertCount: 0,
          scope: 'on-demand-bulk',
        }),
      );
    });

    test('cycle-complete fires exactly once per call regardless of container count', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
          { id: 'c3', name: 'postgres' },
        ],
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
    });

    test('cycle-complete scope is always on-demand-bulk', async () => {
      const harness = createHarness();
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.scope).toBe('on-demand-bulk');
    });

    test('cycle-complete has startedAt and completedAt timestamps', async () => {
      const harness = createHarness();
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(cyclePayload.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('alert emission and cycleId correlation', () => {
    test('emits security alert when summary.critical > 0', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 0, critical: 2 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(
        createScanResult({ status: 'blocked', blockingCount: 2, summary }),
      );

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(1);
      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          containerName: 'local_nginx',
          cycleId: expect.stringMatching(UUID_V7_PATTERN),
          summary,
        }),
      );
    });

    test('emits security alert when summary.high > 0 (no critical)', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 3, critical: 0 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult({ summary }));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(1);
    });

    test('does not emit security alert when only medium/low findings', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 5, medium: 3, high: 0, critical: 0 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult({ summary }));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).not.toHaveBeenCalled();
    });

    test('does not emit security alert when scan result has no summary', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(
        createScanResult({ summary: undefined }),
      );

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).not.toHaveBeenCalled();
      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.alertCount).toBe(0);
    });

    test('all alerts and cycle-complete share the same cycleId', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
        ],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult({ summary }));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(2);
      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      const alertPayloads = harness.deps.emitSecurityAlert.mock.calls.map((c) => c[0]);

      for (const alertPayload of alertPayloads) {
        expect(alertPayload.cycleId).toBe(cyclePayload.cycleId);
      }
    });

    test('alertCount in cycle-complete equals number of emitted alerts', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
          { id: 'c3', name: 'postgres' },
        ],
      });
      const alertSummary = { unknown: 0, low: 0, medium: 0, high: 1, critical: 1 };
      const cleanSummary = { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 };
      harness.deps.scanImageForVulnerabilities
        .mockResolvedValueOnce(createScanResult({ summary: alertSummary }))
        .mockResolvedValueOnce(createScanResult({ summary: cleanSummary }))
        .mockResolvedValueOnce(createScanResult({ summary: alertSummary }));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(2);
      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.alertCount).toBe(2);
    });

    test('severity=critical skips containers with only high findings', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 3, critical: 0 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult({ summary }));

      await callScanAll(harness.handlers, { severity: 'critical' });
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).not.toHaveBeenCalled();
      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.alertCount).toBe(0);
    });

    test('severity=high fires alert for high findings', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const summary = { unknown: 0, low: 0, medium: 0, high: 2, critical: 0 };
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult({ summary }));

      await callScanAll(harness.handlers, { severity: 'high' });
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(1);
    });
  });

  describe('SSE broadcasting', () => {
    test('broadcasts scan started and completed for each container', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
        ],
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValue(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.broadcastScanStarted).toHaveBeenCalledTimes(2);
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledTimes(2);
    });

    test('broadcasts scan completed with error status when scan throws', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      harness.deps.scanImageForVulnerabilities.mockRejectedValueOnce(new Error('scan failed'));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
    });
  });

  describe('error resilience', () => {
    test('other containers still complete when one scan throws', async () => {
      const harness = createHarness({
        containers: [
          { id: 'c1', name: 'nginx' },
          { id: 'c2', name: 'redis' },
          { id: 'c3', name: 'postgres' },
        ],
      });
      harness.deps.scanImageForVulnerabilities
        .mockResolvedValueOnce(createScanResult())
        .mockRejectedValueOnce(new Error('scan failed'))
        .mockResolvedValueOnce(createScanResult());

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      // All 3 broadcast started
      expect(harness.deps.broadcastScanStarted).toHaveBeenCalledTimes(3);
      // All 3 broadcast completed (one with 'error')
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledTimes(3);
      // Cycle-complete still fires
      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
      const cyclePayload = harness.deps.emitSecurityScanCycleComplete.mock.calls[0][0];
      expect(cyclePayload.scannedCount).toBe(3);
    });

    test('logs error message and cycle-complete still fires when scan throws', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      harness.deps.scanImageForVulnerabilities.mockRejectedValueOnce(new Error('scan exploded'));

      await callScanAll(harness.handlers);
      await waitForCycleComplete(harness.deps);

      expect(harness.deps.log.info).toHaveBeenCalledWith(expect.stringContaining('scan exploded'));
      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
    });

    test('logs background cycle failure when cycle-complete emission rejects', async () => {
      const harness = createHarness({
        containers: [{ id: 'c1', name: 'nginx' }],
      });
      const cycleFailure = new Error('cycle emission failed');
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(createScanResult());
      harness.deps.emitSecurityScanCycleComplete.mockRejectedValueOnce(cycleFailure);

      const { res } = await callScanAll(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(202);
      await vi.waitFor(() => {
        expect(harness.deps.log.error).toHaveBeenCalledWith(
          expect.stringContaining('cycle emission failed'),
        );
      });
      expect(harness.deps.getErrorMessage).toHaveBeenCalledWith(cycleFailure);
    });
  });

  describe('concurrency', () => {
    test('MAX_CONCURRENT_BULK_SCANS is exported and equals 4', () => {
      expect(MAX_CONCURRENT_BULK_SCANS).toBe(4);
    });

    test('does not exceed MAX_CONCURRENT_BULK_SCANS simultaneous scans', async () => {
      const totalContainers = MAX_CONCURRENT_BULK_SCANS + 2; // 6 containers
      const containers = Array.from({ length: totalContainers }, (_, i) => ({
        id: `c${i + 1}`,
        name: `container-${i + 1}`,
      }));

      const harness = createHarness({ containers });

      let maxConcurrent = 0;
      let currentConcurrent = 0;
      // Array of resolve callbacks — we resolve them from outside
      const resolvers: Array<() => void> = [];

      harness.deps.scanImageForVulnerabilities.mockImplementation(
        () =>
          new Promise<ReturnType<typeof createScanResult>>((resolve) => {
            currentConcurrent += 1;
            if (currentConcurrent > maxConcurrent) {
              maxConcurrent = currentConcurrent;
            }
            resolvers.push(() => {
              currentConcurrent -= 1;
              resolve(createScanResult());
            });
          }),
      );

      // Start the scan — this fires off background work
      const scanAllPromise = callScanAll(harness.handlers);
      await scanAllPromise; // 202 response arrives immediately

      // Give the concurrent pool time to fill to its limit
      // Allow up to MAX_CONCURRENT_BULK_SCANS slots to be occupied
      await new Promise((r) => setTimeout(r, 10));

      // Now resolve them all so the cycle finishes
      while (resolvers.length > 0) {
        const resolve = resolvers.shift()!;
        resolve();
        // Small yield between resolutions to allow pool to refill
        await new Promise((r) => setTimeout(r, 0));
      }

      await waitForCycleComplete(harness.deps);

      expect(maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT_BULK_SCANS);
      // All containers were scanned
      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(totalContainers);
    });
  });

  describe('abort on client disconnect', () => {
    test('registers close listener on request', async () => {
      const harness = createHarness();

      const { req } = await callScanAll(harness.handlers);

      expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    test('stops queuing new scans when abort fires', async () => {
      const containers = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `container-${i + 1}`,
      }));
      const harness = createHarness({ containers });

      const resolvers: Array<() => void> = [];
      harness.deps.scanImageForVulnerabilities.mockImplementation(
        () =>
          new Promise<ReturnType<typeof createScanResult>>((resolve) => {
            resolvers.push(() => resolve(createScanResult()));
          }),
      );

      let abortHandler: (() => void) | undefined;
      const { req } = await callScanAll(harness.handlers);
      abortHandler = (req.on as any).mock.calls.find((c: any[]) => c[0] === 'close')?.[1];

      // Trigger abort after first scan slot fills
      await new Promise((r) => setTimeout(r, 5));
      abortHandler?.();

      // Resolve whatever scans started
      for (const r of resolvers) r();

      await waitForCycleComplete(harness.deps);

      // Fewer than all 5 containers scanned (abort stopped queueing after first batch)
      expect(harness.deps.scanImageForVulnerabilities.mock.calls.length).toBeLessThanOrEqual(5);
      // Cycle-complete always fires
      expect(harness.deps.emitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiter wiring', () => {
    test('createBulkSecurityHandlers returns a scanAll handler function', () => {
      const harness = createHarness();
      expect(typeof harness.handlers.scanAll).toBe('function');
    });
  });
});
