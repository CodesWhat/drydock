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
  });
});
