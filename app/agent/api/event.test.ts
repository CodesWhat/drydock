import { beforeEach, describe, expect, test } from 'vitest';
import * as event from '../../event/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import * as eventApi from './event.js';

const { mockLogInfo, mockLogWarn, mockLogError, mockLogDebug, mockLoggerChild } = vi.hoisted(
  () => ({
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
    mockLogDebug: vi.fn(),
    mockLoggerChild: vi.fn(),
  }),
);

vi.mock('../../log/index.js', () => ({
  default: {
    child: mockLoggerChild.mockReturnValue({
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
  getLogLevel: vi.fn().mockReturnValue('info'),
}));

vi.mock('../../registry/index.js', () => ({
  getState: vi.fn().mockReturnValue({
    watcher: {
      'docker:local': { configuration: { cron: '0 */6 * * *' } },
    },
  }),
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
      expect(ackPayload).toContain('"memoryGb":16,');
      expect(ackPayload).toContain(
        '"containers":{"total":3,"running":2,"stopped":1,"updatesAvailable":0}',
      );
      expect(ackPayload).toContain('"images":2');
    });

    test('ack payload should include logLevel from configuration', () => {
      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain('"logLevel":"info"');
    });

    test('ack payload should include pollInterval when a watcher has a cron', () => {
      vi.mocked(registry.getState).mockReturnValue({
        watcher: {
          'docker:local': { configuration: { cron: '0 */6 * * *' } } as never,
        },
      } as never);

      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain('"pollInterval":"0 */6 * * *"');
      expect(ackPayload).toContain('"logLevel":"info"');
    });

    test('ack payload should omit pollInterval when no watchers exist', () => {
      vi.mocked(registry.getState).mockReturnValue({ watcher: {} } as never);

      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).not.toContain('"pollInterval"');
      expect(ackPayload).toContain('"logLevel":"info"');
    });

    test('ack payload should omit pollInterval when all watcher crons are empty', () => {
      vi.mocked(registry.getState).mockReturnValue({
        watcher: {
          'docker:local': { configuration: { cron: '' } } as never,
        },
      } as never);

      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).not.toContain('"pollInterval"');
      expect(ackPayload).toContain('"logLevel":"info"');
    });

    test('getAgentWatcherCron uses sorted keys and skips watchers with empty cron', () => {
      // Two watchers: 'aaa' has empty cron (skipped), 'bbb' has valid cron (returned)
      vi.mocked(registry.getState).mockReturnValue({
        watcher: {
          'bbb:local': { configuration: { cron: '0 */12 * * *' } } as never,
          'aaa:local': { configuration: { cron: '' } } as never,
        },
      } as never);

      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      // 'aaa:local' sorts first but has empty cron → skipped; 'bbb:local' provides the cron
      expect(ackPayload).toContain('"pollInterval":"0 */12 * * *"');
    });

    test('getAgentWatcherCron skips watcher with non-string cron and picks next sorted key', () => {
      vi.mocked(registry.getState).mockReturnValue({
        watcher: {
          'aaa:local': { configuration: { cron: 42 } } as never,
          'bbb:local': { configuration: { cron: '0 */6 * * *' } } as never,
        },
      } as never);

      eventApi.subscribeEvents(req, res);
      const ackPayload = res.write.mock.calls[0][0];
      expect(ackPayload).toContain('"pollInterval":"0 */6 * * *"');
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
      // Kill 314:42 ObjectLiteral {} mutant: verify 'id' key is present
      const parsed = JSON.parse(payload.replace(/^data: /, ''));
      expect(parsed.data).toEqual({ id: 'c1' });
    });

    test('container-removed handler should include only id, not other container fields', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const removedHandler = event.registerContainerRemoved.mock.calls[0][0];
      removedHandler({ id: 'container-to-remove', name: 'nginx', watcher: 'local' });

      const payload = res.write.mock.calls[0][0];
      const parsed = JSON.parse(payload.replace(/^data: /, ''));
      // Should only have id, not name or watcher
      expect(parsed.data).toEqual({ id: 'container-to-remove' });
      expect(parsed.data.name).toBeUndefined();
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

    test('update-applied handler should forward container object on update-applied payloads', () => {
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
      expect(payload).toContain('"container"');
      expect(payload).toContain('"name":"nginx"');
    });

    test('update-applied handler should preserve operationId and batchId scalars', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateAppliedHandler = event.registerContainerUpdateApplied.mock.calls[0][0];
      updateAppliedHandler({
        containerName: 'local_nginx',
        containerId: 'c1',
        operationId: 'op-abc',
        batchId: 'batch-1',
        container: { id: 'c1', name: 'nginx', watcher: 'local' },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"operationId":"op-abc"');
      expect(payload).toContain('"containerId":"c1"');
      expect(payload).toContain('"batchId":"batch-1"');
      expect(payload).toContain('"container"');
    });

    test('update-applied handler should omit operationId when empty string', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateAppliedHandler = event.registerContainerUpdateApplied.mock.calls[0][0];
      updateAppliedHandler({ containerName: 'local_nginx', operationId: '' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"operationId"');
    });

    test('update-applied handler should tolerate non-object payloads', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateAppliedHandler = event.registerContainerUpdateApplied.mock.calls[0][0];
      updateAppliedHandler(null);

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-applied');
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

    test('update-failed handler should forward container object and preserve scalar fields', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateFailedHandler = event.registerContainerUpdateFailed.mock.calls[0][0];
      updateFailedHandler({
        containerName: 'local_nginx',
        containerId: 'c1',
        operationId: 'op-fail-1',
        batchId: 'batch-2',
        phase: 'pulling',
        rollbackReason: 'health check failed',
        error: 'pull timed out',
        container: {
          id: 'c1',
          name: 'nginx',
          watcher: 'local',
          security: { scan: { vulnerabilities: [{ id: 'CVE-2024-9999' }] } },
        },
      });

      expect(res.write).toHaveBeenCalled();
      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('dd:update-failed');
      expect(payload).toContain('"containerName":"local_nginx"');
      expect(payload).toContain('"containerId":"c1"');
      expect(payload).toContain('"operationId":"op-fail-1"');
      expect(payload).toContain('"batchId":"batch-2"');
      expect(payload).toContain('"phase":"pulling"');
      expect(payload).toContain('"rollbackReason":"health check failed"');
      expect(payload).toContain('"error":"pull timed out"');
      expect(payload).toContain('"container"');
      expect(payload).toContain('"vulnerabilities"');
    });

    test('update-failed handler should omit operationId when empty string', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateFailedHandler = event.registerContainerUpdateFailed.mock.calls[0][0];
      updateFailedHandler({
        containerName: 'local_nginx',
        error: 'boom',
        operationId: '',
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"operationId"');
    });

    test('update-failed handler should omit rollbackReason when empty string', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updateFailedHandler = event.registerContainerUpdateFailed.mock.calls[0][0];
      updateFailedHandler({
        containerName: 'local_nginx',
        error: 'boom',
        rollbackReason: '',
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"rollbackReason"');
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

  describe('watcher snapshot replay on connect (#386)', () => {
    test('new client receives cached snapshot immediately after ack when one exists', () => {
      // Connect a client so the broadcast from initEvents has somewhere to go
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();

      eventApi.initEvents();

      // Emit a snapshot — this caches it and broadcasts to the existing client
      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1' }],
      });
      res.write.mockClear();

      // A NEW client connects after the snapshot was emitted
      const newReq = { ip: '10.0.0.2', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      // Should have received: ack (call 0) + snapshot replay (call 1)
      expect(newRes.write).toHaveBeenCalledTimes(2);
      const replayCall = newRes.write.mock.calls[1][0];
      expect(replayCall).toContain('dd:watcher-snapshot');
      expect(replayCall).toContain('"type":"docker"');
      expect(replayCall).toContain('"name":"local"');
    });

    test('already-connected clients do NOT receive a second snapshot when a new client connects', () => {
      // Connect an existing client and emit a snapshot to it
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1' }],
      });
      // existing client received the broadcast — record how many writes happened
      const writesBeforeNewConnect = res.write.mock.calls.length;

      // A second client connects — triggers the replay loop for the new client only
      const newReq = { ip: '10.0.0.3', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      // The original client should have received NO additional writes
      expect(res.write).toHaveBeenCalledTimes(writesBeforeNewConnect);
    });

    test('client that subscribes before any snapshot is emitted receives only the ack', () => {
      // No snapshot emitted yet
      const newReq = { ip: '10.0.0.4', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      // Only the ack should be written
      expect(newRes.write).toHaveBeenCalledTimes(1);
      const ackCall = newRes.write.mock.calls[0][0];
      expect(ackCall).toContain('dd:ack');
      expect(ackCall).not.toContain('dd:watcher-snapshot');
    });

    test('only the latest snapshot per watcher is replayed when multiple snapshots are emitted', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];

      // Emit snapshot A
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'old-container' }],
      });

      // Emit snapshot B for the same watcher (overwrites A)
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'new-container' }],
      });

      // A new client connects
      const newReq = { ip: '10.0.0.5', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      // Should receive ack + exactly one snapshot replay (snapshot B)
      expect(newRes.write).toHaveBeenCalledTimes(2);
      const replayCall = newRes.write.mock.calls[1][0];
      expect(replayCall).toContain('new-container');
      expect(replayCall).not.toContain('old-container');
    });

    test('snapshot with missing watcher name is not cached; subsequent client gets ack only', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];

      // Emit a snapshot whose sanitized form has a watcher missing the name field
      // sanitizeWatcherSnapshotPayloadForAgentSse passes watcher through as-is,
      // so a watcher without 'name' will produce a sanitized payload without name.
      snapshotHandler({
        watcher: { type: 'docker' }, // no name
        containers: [],
      });

      // A new client connects — cache should be empty, so only ack
      const newReq = { ip: '10.0.0.6', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      expect(newRes.write).toHaveBeenCalledTimes(1);
      expect(newRes.write.mock.calls[0][0]).toContain('dd:ack');
    });

    test('snapshot with missing watcher field is not cached; subsequent client gets ack only', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];

      // Emit a snapshot with NO watcher field at all; sanitizer produces
      // { watcher: undefined, containers: [] } — cacheWatcherSnapshot hits the
      // `!s.watcher` branch (line 176) and skips caching.
      snapshotHandler({ containers: [{ id: 'c1' }] });

      // A new client connects — cache is empty, so only the ack should be written
      const newReq = { ip: '10.0.0.8', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      expect(newRes.write).toHaveBeenCalledTimes(1);
      expect(newRes.write.mock.calls[0][0]).toContain('dd:ack');
      expect(newRes.write.mock.calls[0][0]).not.toContain('dd:watcher-snapshot');
    });

    test('_resetAgentEventStateForTests clears snapshot cache; post-reset client gets ack only', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const snapshotHandler = event.registerWatcherSnapshot.mock.calls[0][0];
      snapshotHandler({
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1' }],
      });

      // Reset clears the cache
      eventApi._resetAgentEventStateForTests();

      // A new client should receive only the ack (no replay)
      const newReq = { ip: '10.0.0.7', on: vi.fn() };
      const newRes = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(newReq, newRes);

      expect(newRes.write).toHaveBeenCalledTimes(1);
      expect(newRes.write.mock.calls[0][0]).toContain('dd:ack');
    });
  });

  describe('allocateSseClientId', () => {
    test('should rollover to id=1 when starting from MAX_SAFE_INTEGER', () => {
      eventApi._setNextSseClientIdForTests(Number.MAX_SAFE_INTEGER);

      // Connect two clients: first gets id=1 (after rollover), second gets id=2
      const req1 = { ip: '127.0.0.1', on: vi.fn() };
      const res1 = { writeHead: vi.fn(), write: vi.fn() };
      const req2 = { ip: '127.0.0.2', on: vi.fn() };
      const res2 = { writeHead: vi.fn(), write: vi.fn() };

      eventApi.subscribeEvents(req1, res1);
      eventApi.subscribeEvents(req2, res2);

      // Both clients connected; trigger event
      eventApi.initEvents();
      res1.write.mockClear();
      res2.write.mockClear();
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'cx' });

      expect(res1.write).toHaveBeenCalled();
      expect(res2.write).toHaveBeenCalled();

      // Close first client; only second should get events
      const firstClose = req1.on.mock.calls[0][1];
      firstClose();
      res1.write.mockClear();
      res2.write.mockClear();
      addedHandler({ id: 'cy' });
      expect(res1.write).not.toHaveBeenCalled();
      expect(res2.write).toHaveBeenCalled();
    });

    test('should allocate id=1 (not MAX_SAFE_INTEGER+1) after rollover from MAX_SAFE_INTEGER', () => {
      // Verify rollover: if BlockStatement mutant applies (nextSseClientId=0 skipped),
      // then += 1 gives MAX_SAFE_INTEGER (no real change in JS). The filter
      // c.id !== client.id won't work correctly for a second client with the same ID.
      eventApi._setNextSseClientIdForTests(Number.MAX_SAFE_INTEGER);

      // First client after rollover should get id=1
      eventApi.subscribeEvents(req, res);

      // Reset to make a second client with id=2
      const req2 = { ip: '127.0.0.2', on: vi.fn() };
      const res2 = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(req2, res2);

      // If rollover worked: client1.id=1, client2.id=2 - distinct, so close #1 only removes #1
      // If mutant (no rollover): both ids = MAX_SAFE_INTEGER → close #1 removes both
      const close1 = req.on.mock.calls[0][1];
      close1();

      // trigger event; only res2 should fire
      eventApi.initEvents();
      res.write.mockClear();
      res2.write.mockClear();
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'test' });
      expect(res2.write).toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
    });

    test('should increment id by exactly 1 each connection from id=0', () => {
      eventApi._setNextSseClientIdForTests(0);

      const req1 = { ip: '127.0.0.1', on: vi.fn() };
      const res1 = { writeHead: vi.fn(), write: vi.fn() };
      const req2 = { ip: '127.0.0.2', on: vi.fn() };
      const res2 = { writeHead: vi.fn(), write: vi.fn() };

      eventApi.subscribeEvents(req1, res1);
      eventApi.subscribeEvents(req2, res2);

      // Two clients should have distinct IDs (1 and 2), confirmed by close handler filtering
      res1.write.mockClear();
      res2.write.mockClear();

      const firstClose = req1.on.mock.calls[0][1];
      firstClose();

      // Trigger an event: only second client should receive it
      eventApi.initEvents();
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'cx' });

      expect(res1.write).not.toHaveBeenCalled();
      expect(res2.write).toHaveBeenCalled();
    });

    test('should not rollover when at MAX_SAFE_INTEGER minus 1', () => {
      // With the >= check: MAX_SAFE_INTEGER-1 < MAX_SAFE_INTEGER so no rollover
      // With the > mutant: same — MAX_SAFE_INTEGER-1 < MAX_SAFE_INTEGER so no rollover
      // These are distinguishable at exactly MAX_SAFE_INTEGER (above test)
      eventApi._setNextSseClientIdForTests(Number.MAX_SAFE_INTEGER - 1);
      eventApi.subscribeEvents(req, res);
      expect(res.write).toHaveBeenCalled();
      const ack = res.write.mock.calls[0][0];
      expect(ack).toContain('dd:ack');
    });
  });

  describe('toAgentRuntimeEnvEntries filter', () => {
    test('should filter out entries with non-string key', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'c1',
        details: {
          env: [
            { key: 123, value: 'should-be-filtered' },
            { key: 'VALID_KEY', value: 'valid-value' },
          ],
        },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"key":123');
      expect(payload).toContain('"VALID_KEY"');
      expect(payload).toContain('"valid-value"');
    });

    test('should filter out entries with non-string value', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'c1',
        details: {
          env: [
            { key: 'BAD_VAL', value: 42 },
            { key: 'GOOD', value: 'yes' },
          ],
        },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"BAD_VAL"');
      expect(payload).toContain('"GOOD"');
      expect(payload).toContain('"yes"');
    });

    test('should filter out null entries', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'c1',
        details: {
          env: [null, undefined, { key: 'KEPT', value: 'yes' }],
        },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"KEPT"');
      expect(payload).toContain('"yes"');
    });

    test('should filter out primitive (non-object) entries', () => {
      // Tests the !!entry && typeof entry === 'object' condition
      // A number like 42 is truthy but typeof 42 !== 'object', should be filtered
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'c1',
        details: {
          env: [42, 'a-string', { key: 'KEPT', value: 'kept-val' }],
        },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"KEPT"');
      expect(payload).toContain('"kept-val"');
      // The primitive entries should not appear as keys
      expect(payload).not.toContain('"42"');
    });

    test('should return empty array when all entries are filtered out', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({
        id: 'c1',
        details: {
          env: [null, { key: 123, value: 456 }],
        },
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"env":[]');
    });
  });

  describe('sanitizeContainerDetailsForAgentSse', () => {
    test('should return falsy details unchanged (null)', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({ id: 'c1', details: null });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"details":null');
    });

    test('should return string details unchanged', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({ id: 'c1', details: 'raw-string' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"details":"raw-string"');
    });

    test('should return number details unchanged (non-object non-falsy)', () => {
      // Tests the `typeof details !== 'object'` condition with a number
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const updatedHandler = event.registerContainerUpdated.mock.calls[0][0];
      updatedHandler({ id: 'c1', details: 42 });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"details":42');
    });
  });

  describe('sanitizeContainerLifecyclePayloadForAgentSse', () => {
    test('should pass through payload without details key', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c1', name: 'no-details-key' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"name":"no-details-key"');
    });

    test('should pass through null payload unchanged', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler(null);

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":null');
    });

    test('should pass through number payload unchanged (non-object truthy)', () => {
      // Tests the `typeof payload !== 'object'` condition with a number
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler(42);

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":42');
    });

    test('should wrap sanitized details when details key is explicitly present', () => {
      // Tests the !Object.hasOwn condition: when 'details' IS in payload, sanitize it
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({
        id: 'c1',
        details: {
          env: [{ key: 'FOO', value: 'bar' }],
        },
      });

      const payload = res.write.mock.calls[0][0];
      // details should be sanitized (env entries preserved as RuntimeEnvEntry objects)
      expect(payload).toContain('"key":"FOO"');
      expect(payload).toContain('"value":"bar"');
    });

    test('should return sanitized payload when details key is present (BlockStatement kill)', () => {
      // Kill BlockStatement mutant at 119:54: if hasOwn check fails to return payload,
      // it proceeds to sanitize. Test that EXISTING details key does trigger sanitization.
      storeContainer.getContainerRaw.mockReturnValue(undefined);
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      // Payload with 'details' key containing array env
      addedHandler({ id: 'c2', name: 'container', details: { env: [{ key: 'X', value: 'y' }] } });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"name":"container"');
      expect(payload).toContain('"key":"X"');
    });
  });

  describe('getAgentContainerSsePayload', () => {
    test('should use raw store data when container id string present and raw found', () => {
      const rawContainer = { id: 'c1', name: 'from-store', watcher: 'local' };
      storeContainer.getContainerRaw.mockReturnValue(rawContainer);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c1', name: 'event-version' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"name":"from-store"');
      expect(payload).not.toContain('"name":"event-version"');
    });

    test('should fall through to sanitize when container id is not a string', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 42, name: 'numeric-id' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"name":"numeric-id"');
      // getContainerRaw should not be called with non-string id
      expect(storeContainer.getContainerRaw).not.toHaveBeenCalled();
    });

    test('should fall through when raw lookup returns undefined', () => {
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'unknown', name: 'event-version' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"name":"event-version"');
    });

    test('should pass through number payload without calling getContainerRaw', () => {
      // Tests typeof payload === 'object' condition: a number is not an object,
      // so getContainerRaw should not be called
      storeContainer.getContainerRaw.mockReturnValue(undefined);

      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler(99);

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":99');
      expect(storeContainer.getContainerRaw).not.toHaveBeenCalled();
    });
  });

  describe('sanitizeUpdateAppliedPayloadForAgentSse', () => {
    test('should pass string payload through unchanged with exact string value', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler('my_container');

      const payload = res.write.mock.calls[0][0];
      // Exact string should be the data value, not wrapped in an object
      expect(payload).toContain('"data":"my_container"');
      expect(payload).not.toContain('"containerId"');
    });

    test('should pass string payload through (not as object) to kill BlockStatement mutant', () => {
      // Kill 195:36 BlockStatement: if block is empty, string falls through to
      // the `!payload || typeof payload !== 'object'` check which is true for string,
      // so it still returns. But then it loses the object shape check path.
      // Actually we need to verify that after the first if, the function returns early.
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler('the-container-name');

      const payload = res.write.mock.calls[0][0];
      const parsed = JSON.parse(payload.replace(/^data: /, ''));
      // Should be the exact string, not an object with containerId etc.
      expect(parsed.data).toBe('the-container-name');
    });

    test('should pass number payload through (non-object non-string)', () => {
      // Tests 198:19 `typeof payload !== 'object' → false`
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler(42);

      const payload = res.write.mock.calls[0][0];
      const parsed = JSON.parse(payload.replace(/^data: /, ''));
      expect(parsed.data).toBe(42);
    });

    test('should use empty string when containerId is null', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler({ containerName: 'nginx', containerId: null });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"containerId":""');
    });

    test('should use null when batchId is null', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler({ containerName: 'nginx', batchId: null });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"batchId":null');
    });

    test('should preserve batchId when set', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler({ containerName: 'nginx', batchId: 'batch-xyz' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"batchId":"batch-xyz"');
    });

    test('should omit operationId when not set', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateApplied.mock.calls[0][0];
      handler({ containerName: 'nginx' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"operationId"');
    });
  });

  describe('sanitizeUpdateFailedPayloadForAgentSse', () => {
    test('should use empty string phase when phase is null', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateFailed.mock.calls[0][0];
      handler({ containerName: 'nginx', error: 'boom', phase: null });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"phase":""');
    });

    test('should use empty string containerId when containerId is null', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateFailed.mock.calls[0][0];
      handler({ containerName: 'nginx', error: 'boom', containerId: null });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"containerId":""');
    });

    test('should include rollbackReason when non-empty', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateFailed.mock.calls[0][0];
      handler({ containerName: 'nginx', error: 'boom', rollbackReason: 'health-check' });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"rollbackReason":"health-check"');
    });

    test('should omit rollbackReason when it is a non-string type', () => {
      // Tests 224:9 `typeof payload.rollbackReason === 'string' → true`
      // If mutant applies, non-string rollbackReason would still be included
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerContainerUpdateFailed.mock.calls[0][0];
      handler({ containerName: 'nginx', error: 'boom', rollbackReason: 42 });

      const payload = res.write.mock.calls[0][0];
      expect(payload).not.toContain('"rollbackReason"');
    });
  });

  describe('sanitizeSecurityAlertPayloadForAgentSse', () => {
    test('should pass through null payload unchanged', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityAlert.mock.calls[0][0];
      handler(null);

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":null');
    });

    test('should pass through string payload unchanged', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityAlert.mock.calls[0][0];
      handler('alert-string');

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":"alert-string"');
    });

    test('should include summary and status from object payload', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityAlert.mock.calls[0][0];
      handler({
        containerName: 'nginx',
        details: 'cve details',
        status: 'warning',
        summary: 'summary text',
        blockingCount: 0,
        cycleId: 'cycle-1',
        extraField: 'should-be-stripped',
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"summary":"summary text"');
      expect(payload).toContain('"status":"warning"');
      expect(payload).not.toContain('"extraField"');
    });
  });

  describe('sanitizeSecurityScanCycleCompletePayloadForAgentSse', () => {
    test('should pass through null payload unchanged', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityScanCycleComplete.mock.calls[0][0];
      handler(null);

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":null');
    });

    test('should pass through string payload unchanged', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityScanCycleComplete.mock.calls[0][0];
      handler('cycle-string');

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"data":"cycle-string"');
    });

    test('should strip extra fields and keep only expected keys', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      const handler = event.registerSecurityScanCycleComplete.mock.calls[0][0];
      handler({
        cycleId: 'cycle-xyz',
        scannedCount: 3,
        alertCount: 1,
        startedAt: '2026-04-17T22:30:00.000Z',
        completedAt: '2026-04-17T22:30:10.000Z',
        extraField: 'should-be-stripped',
      });

      const payload = res.write.mock.calls[0][0];
      expect(payload).toContain('"cycleId":"cycle-xyz"');
      expect(payload).toContain('"scannedCount":3');
      expect(payload).toContain('"alertCount":1');
      expect(payload).not.toContain('"extraField"');
    });
  });

  describe('container summary cache', () => {
    test('should recompute summary when cache expires', () => {
      // First call - creates cache
      eventApi.subscribeEvents(req, res);
      expect(storeContainer.getContainers).toHaveBeenCalledTimes(1);

      // Advance time beyond cache TTL (2000ms)
      mockedNow += 5_000;
      vi.spyOn(Date, 'now').mockReturnValue(mockedNow);

      const req2 = { ip: '127.0.0.3', on: vi.fn() };
      const res2 = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(req2, res2);

      // Should recompute since cache is expired
      expect(storeContainer.getContainers).toHaveBeenCalledTimes(2);
    });

    test('cache expiry uses strict greater-than (expiresAtMs > nowMs)', () => {
      // Connect first client - cache set with expiresAtMs = mockedNow + 2000
      eventApi.subscribeEvents(req, res);
      expect(storeContainer.getContainers).toHaveBeenCalledTimes(1);

      // Advance time to exactly expiresAtMs (cache should be considered expired - not >)
      mockedNow += 2_000;
      vi.spyOn(Date, 'now').mockReturnValue(mockedNow);

      const req2 = { ip: '127.0.0.3', on: vi.fn() };
      const res2 = { writeHead: vi.fn(), write: vi.fn() };
      eventApi.subscribeEvents(req2, res2);

      // expiresAtMs == nowMs means NOT > so recompute happens
      expect(storeContainer.getContainers).toHaveBeenCalledTimes(2);
    });
  });

  describe('memoryGb calculation', () => {
    test('should compute memoryGb as totalmem divided by 1024^3 (exact value)', () => {
      // totalmem mock returns 16 * 1024 * 1024 * 1024 = 16GB
      // Exact assertion: 16.0 not 16384 or 16777216
      eventApi.subscribeEvents(req, res);

      const ack = res.write.mock.calls[0][0];
      const parsed = JSON.parse(ack.replace(/^data: /, ''));
      expect(parsed.data.memoryGb).toBe(16);
    });

    test('should compute memoryGb as exactly 16 not 16384 for 16GB machine', () => {
      // Kill arithmetic mutants: / 1024 / 1024 * 1024 would give 16384
      // / 1024 * 1024 would give 16*1024^3/1024 etc. - all much larger than 16
      eventApi.subscribeEvents(req, res);

      const ack = res.write.mock.calls[0][0];
      const parsed = JSON.parse(ack.replace(/^data: /, ''));
      expect(parsed.data.memoryGb).toBeGreaterThan(0);
      expect(parsed.data.memoryGb).toBeLessThan(100); // Not thousands
      expect(parsed.data.memoryGb).toBe(16);
    });
  });

  describe('sseClients management', () => {
    test('close handler should send event to sseClients.filter result', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();

      // Trigger an event to all connected clients
      eventApi.initEvents();
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c1' });

      // Client is present, should receive event
      expect(res.write).toHaveBeenCalled();

      res.write.mockClear();

      // Disconnect the client
      const closeHandler = req.on.mock.calls[0][1];
      closeHandler();

      addedHandler({ id: 'c2' });
      // Client removed, should NOT receive event
      expect(res.write).not.toHaveBeenCalled();
    });

    test('_resetAgentEventStateForTests should clear sseClients and reset state', () => {
      eventApi.subscribeEvents(req, res);
      res.write.mockClear();
      eventApi.initEvents();

      // Connect a client
      const addedHandler = event.registerContainerAdded.mock.calls[0][0];
      addedHandler({ id: 'c1' });
      expect(res.write).toHaveBeenCalled();
      res.write.mockClear();

      // Reset state
      eventApi._resetAgentEventStateForTests();

      // After reset, re-register and re-connect, old client should not get events
      eventApi.initEvents();
      const addedHandler2 = event.registerContainerAdded.mock.calls[1][0];
      addedHandler2({ id: 'c2' });
      expect(res.write).not.toHaveBeenCalled();
    });
  });
});
