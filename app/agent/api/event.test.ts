import { beforeEach, describe, expect, test } from 'vitest';
import * as event from '../../event/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as storeContainer from '../../store/container.js';
import * as eventApi from './event.js';

const { mockLogInfo, mockLogWarn, mockLogError, mockLogDebug } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({
      info: mockLogInfo,
      warn: mockLogWarn,
      error: mockLogError,
      debug: mockLogDebug,
    }),
  },
}));

vi.mock('../../event/index.js', () => ({
  registerContainerAdded: vi.fn(),
  registerContainerUpdated: vi.fn(),
  registerContainerRemoved: vi.fn(),
  registerWatcherSnapshot: vi.fn(),
  registerContainerUpdateApplied: vi.fn(),
  registerContainerUpdateFailed: vi.fn(),
  registerUpdateOperationChanged: vi.fn(),
  registerBatchUpdateCompleted: vi.fn(),
  registerSecurityAlert: vi.fn(),
  registerSecurityScanCycleComplete: vi.fn(),
}));

vi.mock('../../configuration/index.js', () => ({
  getVersion: vi.fn().mockReturnValue('1.0.0'),
}));

vi.mock('node:os', () => ({
  default: {
    platform: vi.fn(() => 'linux'),
    release: vi.fn(() => '6.8.0'),
    arch: vi.fn(() => 'x64'),
    cpus: vi.fn(() => new Array(8).fill({ model: 'cpu' })),
    totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024),
  },
}));

vi.mock('../../store/container.js', () => ({
  getContainers: vi.fn(() => [
    { id: 'c1', status: 'running', image: { id: 'img-1' } },
    { id: 'c2', status: 'exited', image: { id: 'img-2' } },
    { id: 'c3', status: 'running', image: { id: 'img-1' } },
  ]),
  getContainerRaw: vi.fn(),
}));

describe('agent API event', () => {
  let req;
  let res;
  let mockedNow = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    eventApi._resetAgentEventStateForTests();
    mockedNow += 10_000;
    vi.spyOn(Date, 'now').mockReturnValue(mockedNow);
    req = {
      ip: '127.0.0.1',
      on: vi.fn(),
    };
    res = {
      writeHead: vi.fn(),
      write: vi.fn(),
    };
  });

  describe('subscribeEvents', () => {
    test('should rollover SSE client id when max safe integer is reached', () => {
      eventApi._setNextSseClientIdForTests(Number.MAX_SAFE_INTEGER);

      eventApi.subscribeEvents(req, res);

      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain('dd:ack');
    });

    test('should reuse container summary for rapid consecutive ack payloads', () => {
      const secondReq = {
        ip: '127.0.0.2',
        on: vi.fn(),
      };
      const secondRes = {
        writeHead: vi.fn(),
        write: vi.fn(),
      };

      eventApi.subscribeEvents(req, res);
      eventApi.subscribeEvents(secondReq, secondRes);

      expect(storeContainer.getContainers).toHaveBeenCalledTimes(1);
    });

    test('should set SSE headers and send ack', () => {
      eventApi.subscribeEvents(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      });
      expect(res.write).toHaveBeenCalled();
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain('data: ');
      expect(ackPayload).toContain('dd:ack');
      expect(ackPayload).toContain('1.0.0');
      expect(ackPayload).toContain('linux');
      expect(ackPayload).toContain('x64');
      expect(ackPayload).toContain('"cpus":8');
      expect(ackPayload).toContain('"memoryGb":16');
      expect(ackPayload).toContain(
        '"containers":{"total":3,"running":2,"stopped":1,"updatesAvailable":0}',
      );
      expect(ackPayload).toContain('"images":2');
    });

    test('should compute image and stopped counts using fallback image keys', () => {
      storeContainer.getContainers.mockReturnValue([
        { id: 'c1', status: 'running', image: { name: 'img-name' } },
        { id: 'c2', status: 'created', image: {} },
        { id: 'c3' },
      ]);

      eventApi.subscribeEvents(req, res);

      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain(
        '"containers":{"total":3,"running":1,"stopped":2,"updatesAvailable":0}',
      );
      expect(ackPayload).toContain('"images":3');
    });

    test('should register close handler', () => {
      eventApi.subscribeEvents(req, res);
      expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    test('should sanitize controller ip in connect/disconnect logs', () => {
      const maliciousIp = '198.51.100.42\x1b[31m\r\nspoofed-ip';
      req.ip = maliciousIp;

      eventApi.subscribeEvents(req, res);

      expect(mockLogInfo).toHaveBeenCalledWith(
        `Controller drydock with ip ${sanitizeLogParam(maliciousIp)} connected.`,
      );

      const closeHandler = req.on.mock.calls[0][1];
      closeHandler();

      expect(mockLogInfo).toHaveBeenCalledWith(
        `Controller drydock with ip ${sanitizeLogParam(maliciousIp)} disconnected.`,
      );
    });

    test('close handler should remove client from list', () => {
      eventApi.subscribeEvents(req, res);
      const closeHandler = req.on.mock.calls[0][1];
      // Should not throw
      closeHandler();
    });

    test('close handler should only remove the disconnected client when connect timestamps collide', () => {
      const firstReq = {
        ip: '127.0.0.1',
        on: vi.fn(),
      };
      const firstRes = {
        writeHead: vi.fn(),
        write: vi.fn(),
      };
      const secondReq = {
        ip: '127.0.0.2',
        on: vi.fn(),
      };
      const secondRes = {
        writeHead: vi.fn(),
        write: vi.fn(),
      };

      eventApi.subscribeEvents(firstReq, firstRes);
      eventApi.subscribeEvents(secondReq, secondRes);

      const firstCloseHandler = firstReq.on.mock.calls[0][1];
      firstCloseHandler();

      secondRes.write.mockClear();
      eventApi.initEvents();
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c2', name: 'still-connected' });

      expect(secondRes.write).toHaveBeenCalled();
    });
  });

  describe('initEvents', () => {
    test('should register container event listeners', () => {
      eventApi.initEvents();
      expect(event.registerContainerAdded).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerContainerUpdated).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerContainerRemoved).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerWatcherSnapshot).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerContainerUpdateApplied).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerContainerUpdateFailed).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerUpdateOperationChanged).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerBatchUpdateCompleted).toHaveBeenCalledWith(expect.any(Function));
      expect(event.registerSecurityAlert).toHaveBeenCalledWith(expect.any(Function));
    });

    test('container-added handler should send SSE to connected clients', () => {
      // Connect a client first
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();

      eventApi.initEvents();

      // Get the registered handler for container-added
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c1', name: 'test' });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-added');
    });

    test('container-updated handler should send SSE to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();

      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({ id: 'c1', name: 'test' });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-updated');
    });

    test('container-added handler should emit schema-safe env entries without sensitive metadata', () => {
      storeContainer.getContainerRaw.mockReturnValue({
        id: 'c1',
        details: {
          ports: [],
          volumes: [],
          env: [{ key: 'API_TOKEN', value: 'super-secret' }],
        },
      });

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({
        id: 'c1',
        details: {
          env: [{ key: 'API_TOKEN', value: '[REDACTED]', sensitive: true }],
        },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-added');
      expect(payload).toContain('"key":"API_TOKEN"');
      expect(payload).toContain('"value":"super-secret"');
      expect(payload).not.toContain('"sensitive"');
    });

    test('container-updated handler should strip sensitive metadata when raw payload lookup misses', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'missing-container',
        details: {
          ports: [],
          volumes: [],
          env: [{ key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true }],
        },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-updated');
      expect(payload).toContain('"key":"DB_PASSWORD"');
      expect(payload).toContain('"value":"[REDACTED]"');
      expect(payload).not.toContain('"sensitive"');
    });

    test('container-updated handler should keep non-array env details unchanged on fallback sanitization', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'missing-container',
        details: {
          env: 'not-an-array',
        },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-updated');
      expect(payload).toContain('"env":"not-an-array"');
    });

    test('container-updated handler should keep non-object details unchanged on fallback sanitization', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'missing-container',
        details: 'opaque-details',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-updated');
      expect(payload).toContain('"details":"opaque-details"');
    });

    test('container-added handler should not crash on non-object payload', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler(undefined);

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-added');
    });

    test('container-removed handler should send SSE with container id', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();

      eventApi.initEvents();

      const removedHandler = event.registerContainerRemoved.mock.calls[0][0];
      removedHandler({ id: 'c1' });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:container-removed');
    });

    test('update-applied handler should send SSE to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateAppliedHandler = event.registerContainerUpdateApplied.mock.calls[0][0];
      updateAppliedHandler('local_nginx');

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-applied');
      expect(payload).toContain('"local_nginx"');
    });

    test('update-applied handler should send object payloads to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateAppliedHandler = event.registerContainerUpdateApplied.mock.calls[0][0];
      updateAppliedHandler({
        containerName: 'local_nginx',
        container: {
          id: 'c1',
          name: 'nginx',
          watcher: 'local',
        },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-applied');
      expect(payload).toContain('"containerName":"local_nginx"');
      expect(payload).toContain('"name":"nginx"');
    });

    test('update-failed handler should send SSE to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateFailedHandler = event.registerContainerUpdateFailed.mock.calls[0][0];
      updateFailedHandler({
        containerName: 'local_nginx',
        error: 'compose pull failed',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-failed');
      expect(payload).toContain('"containerName":"local_nginx"');
      expect(payload).toContain('"error":"compose pull failed"');
    });

    test('update-operation-changed handler should send SSE to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const operationHandler = event.registerUpdateOperationChanged.mock.calls[0][0];
      operationHandler({
        operationId: 'agent-op-1',
        containerName: 'local_nginx',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-operation-changed');
      expect(payload).toContain('"operationId":"agent-op-1"');
      expect(payload).toContain('"phase":"pulling"');
    });

    test('batch-update-completed handler should send SSE to connected clients', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const batchHandler = event.registerBatchUpdateCompleted.mock.calls[0][0];
      batchHandler({
        batchId: 'batch-agent-1',
        total: 2,
        succeeded: 2,
        failed: 0,
        durationMs: 1200,
        items: [
          {
            operationId: 'op-1',
            containerId: 'c1',
            containerName: 'local_nginx',
            status: 'succeeded',
          },
          {
            operationId: 'op-2',
            containerId: 'c2',
            containerName: 'local_redis',
            status: 'succeeded',
          },
        ],
        timestamp: '2026-04-29T12:00:00.000Z',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:batch-update-completed');
      expect(payload).toContain('"batchId":"batch-agent-1"');
      expect(payload).toContain('"total":2');
    });

    test('security-alert handler should omit container payload so controller resolves its own store state', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const securityAlertHandler = event.registerSecurityAlert.mock.calls[0][0];
      securityAlertHandler({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        container: { id: 'c1', name: 'nginx' },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:security-alert');
      expect(payload).toContain('"containerName":"local_nginx"');
      expect(payload).toContain('"details":"1 critical vulnerability"');
      expect(payload).toContain('"status":"blocked"');
      expect(payload).toContain('"blockingCount":1');
      expect(payload).not.toContain('"container"');
    });

    test('security-alert handler should tolerate non-object payloads', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const securityAlertHandler = event.registerSecurityAlert.mock.calls[0][0];
      securityAlertHandler(undefined);

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:security-alert');
      expect(payload).not.toContain('"containerName"');
      expect(payload).not.toContain('"details"');
    });

    test('security-alert handler should include cycleId so controller can correlate cycles', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const securityAlertHandler = event.registerSecurityAlert.mock.calls[0][0];
      securityAlertHandler({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        cycleId: 'cycle-xyz',
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"cycleId":"cycle-xyz"');
    });

    test('security-scan-cycle-complete handler should forward cycle metadata to subscribers', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const cycleHandler = event.registerSecurityScanCycleComplete.mock.calls[0][0];
      cycleHandler({
        cycleId: 'cycle-xyz',
        scannedCount: 5,
        alertCount: 2,
        startedAt: '2026-04-17T22:30:00.000Z',
        completedAt: '2026-04-17T22:30:10.000Z',
        scope: 'scheduled',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:security-scan-cycle-complete');
      expect(payload).toContain('"cycleId":"cycle-xyz"');
      expect(payload).toContain('"scannedCount":5');
      expect(payload).toContain('"alertCount":2');
    });

    test('security-scan-cycle-complete handler should tolerate non-object payloads', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const cycleHandler = event.registerSecurityScanCycleComplete.mock.calls[0][0];
      cycleHandler(null);

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:security-scan-cycle-complete');
    });

    test('watcher-snapshot handler should send watcher identity and sanitized containers', () => {
      storeContainer.getContainerRaw.mockReturnValueOnce({
        id: 'c1',
        watcher: 'local',
        details: {
          env: [{ key: 'API_TOKEN', value: 'super-secret' }],
        },
      });

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [
          {
            id: 'c1',
            watcher: 'local',
            details: {
              env: [{ key: 'API_TOKEN', value: '[REDACTED]', sensitive: true }],
            },
          },
        ],
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:watcher-snapshot');
      expect(payload).toContain('"type":"docker"');
      expect(payload).toContain('"name":"local"');
      expect(payload).toContain('"key":"API_TOKEN"');
      expect(payload).toContain('"value":"super-secret"');
      expect(payload).not.toContain('"sensitive"');
    });

    test('watcher-snapshot handler should emit an empty container list for non-array containers', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: 'invalid',
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:watcher-snapshot');
      expect(payload).toContain('"containers":[]');
    });

    test('watcher-snapshot handler should pass through non-object payloads', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler('invalid-snapshot');

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:watcher-snapshot');
      expect(payload).toContain('"data":"invalid-snapshot"');
    });
  });
});
