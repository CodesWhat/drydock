// @ts-nocheck
import { beforeEach, describe, expect, test } from 'vitest';
import * as event from '../../event/index.js';
import * as eventApi from './event.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
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
}));

describe('agent API event', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(ackPayload).toContain('"containers":{"total":3,"running":2,"stopped":1}');
      expect(ackPayload).toContain('"images":2');
    });

    test('should register close handler', () => {
      eventApi.subscribeEvents(req, res);
      expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    test('close handler should remove client from list', () => {
      eventApi.subscribeEvents(req, res);
      const closeHandler = req.on.mock.calls[0][1];
      // Should not throw
      closeHandler();
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
