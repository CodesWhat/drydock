// @ts-nocheck

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

vi.mock('axios');
vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));
const mockResolveConfiguredPath = vi.hoisted(() => vi.fn((path) => path));
vi.mock('../runtime/paths.js', () => ({
  resolveConfiguredPath: mockResolveConfiguredPath,
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../store/container.js', () => ({
  getContainers: vi.fn().mockReturnValue([]),
  getContainer: vi.fn(),
  insertContainer: vi.fn((c) => c),
  updateContainer: vi.fn((c) => c),
  deleteContainer: vi.fn(),
}));
vi.mock('../event/index.js', () => ({
  emitContainerReport: vi.fn(),
}));
vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn(),
  registerComponent: vi.fn(),
}));

import * as event from '../event/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { AgentClient } from './AgentClient.js';

describe('AgentClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfiguredPath.mockImplementation((path) => path);
    vi.useFakeTimers();
    client = new AgentClient('test-agent', {
      host: 'localhost',
      port: 3001,
      secret: 'test-secret', // NOSONAR - test fixture, not a real credential
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    test('should set name and config', () => {
      expect(client.name).toBe('test-agent');
      expect(client.config.host).toBe('localhost');
      expect(client.config.port).toBe(3001);
      expect(client.isConnected).toBe(false);
    });

    test('should build baseUrl with http when no certfile', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's', // NOSONAR - test fixture, not a real credential
      });
      expect(c.baseUrl).toBe('http://myhost:4000');
    });

    test('should build baseUrl with https when certfile is provided', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's', // NOSONAR - test fixture, not a real credential
        certfile: '/path/to/cert.pem',
        keyfile: '/path/to/key.pem',
        cafile: '/path/to/ca.pem',
      });
      expect(c.baseUrl).toBe('https://myhost:4000');
    });

    test('should build baseUrl with https when using port 443', () => {
      const c = new AgentClient('a', {
        host: 'agent.example.com',
        port: 443,
        secret: 's', // NOSONAR - test fixture, not a real credential
      });
      expect(c.baseUrl).toBe('https://agent.example.com');
    });

    test('should handle host that already starts with http', () => {
      // Intentionally using http:// to verify protocol-prefix detection logic
      const c = new AgentClient('a', {
        host: 'http://myhost', // NOSONAR - intentional http for branch coverage
        port: 4000,
        secret: 's', // NOSONAR - test fixture, not a real credential
      });
      expect(c.baseUrl).toBe('http://myhost:4000');
    });

    test('should default port to 3000 when not provided', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 0,
        secret: 's', // NOSONAR - test fixture, not a real credential
      });
      expect(c.baseUrl).toBe('http://myhost:3000');
    });

    test('should create https agent when certfile without cafile', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's', // NOSONAR - test fixture, not a real credential
        certfile: '/path/to/cert.pem',
      });
      expect(c.baseUrl).toBe('https://myhost:4000');
      expect(c.axiosOptions.httpsAgent).toBeDefined();
    });

    test('should skip cert file read when resolved cert path is empty', () => {
      mockResolveConfiguredPath.mockImplementation((path, options) => {
        if (options?.label === 'a cert file') {
          return '';
        }
        return path;
      });

      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's', // NOSONAR - test fixture, not a real credential
        certfile: '/path/to/cert.pem',
      });

      expect(c.axiosOptions.httpsAgent).toBeDefined();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw when host uses an unsupported protocol', () => {
      expect(
        () =>
          new AgentClient('a', {
            host: 'httpx://myhost',
            port: 4000,
            secret: 's', // NOSONAR - test fixture, not a real credential
          }),
      ).toThrowError('Invalid agent URL protocol: httpx:');
    });
  });

  describe('init', () => {
    test('should call startSse', async () => {
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      await client.init();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('processContainer', () => {
    test('should insert new container and emit report with changed=true', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c1', updateAvailable: false });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(container.agent).toBe('test-agent');
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });

    test('should update existing container and detect changes', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(container);
      expect(existing.resultChanged).toHaveBeenCalled();
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });

    test('should set changed=false when result has not changed', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(false),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should set changed=false when updateAvailable is false', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: false,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should handle existing container without resultChanged function', async () => {
      const existing = { id: 'c1' }; // no resultChanged
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });
  });

  describe('handshake', () => {
    test('should fetch containers, process them, and register components', async () => {
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      axios.get
        .mockResolvedValueOnce({ data: containers }) // containers
        .mockResolvedValueOnce({ data: [{ type: 'docker', name: 'local', configuration: {} }] }) // watchers
        .mockResolvedValueOnce({ data: [{ type: 'docker', name: 'update', configuration: {} }] }); // triggers

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(storeContainer.insertContainer).toHaveBeenCalledTimes(2);
      expect(registry.deregisterAgentComponents).toHaveBeenCalledWith('test-agent');
      expect(registry.registerComponent).toHaveBeenCalledTimes(2);
      expect(registry.registerComponent).toHaveBeenCalledWith(
        expect.objectContaining({ componentPath: 'agent/components' }),
      );
      expect(client.isConnected).toBe(true);
    });

    test('should handle watcher fetch failure gracefully', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockRejectedValueOnce(new Error('network error')) // watchers fail
        .mockResolvedValueOnce({ data: [] }); // triggers

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();
      expect(client.isConnected).toBe(true);
    });

    test('should handle trigger fetch failure gracefully', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockRejectedValueOnce(new Error('network error'));

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();
      expect(client.isConnected).toBe(true);
    });
  });

  describe('pruneOldContainers (tested via handshake)', () => {
    test('should prune containers not in agent response', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [{ id: 'c1' }] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'c1', name: 'c1' },
        { id: 'c2', name: 'c2' },
      ]);

      await client.handshake();

      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
    });

    test('should prune with watcher filter when watcher is specified', async () => {
      // This is tested through the watch method
      const reports = [{ container: { id: 'c1' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'c1', name: 'c1' },
        { id: 'c2', name: 'c2' },
      ]);

      await client.watch('docker', 'local');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
    });
  });

  describe('scheduleReconnect', () => {
    test('should set isConnected to false and schedule reconnect', () => {
      client.isConnected = true;
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      client.scheduleReconnect(1000);
      expect(client.isConnected).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalled();
    });

    test('should not schedule duplicate reconnects', () => {
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      client.scheduleReconnect(1000);
      client.scheduleReconnect(1000); // second call should be ignored
      vi.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('startSse', () => {
    test('should clear existing reconnect timer', () => {
      const spy = vi.spyOn(client, 'startSse');
      client.scheduleReconnect(5000);
      // Now startSse should clear the timer
      axios.mockResolvedValue({ data: new EventEmitter() });
      client.startSse();
      // The original scheduled call after timer should not fire a new startSse
      expect(spy).toHaveBeenCalled();
    });

    test('should establish SSE stream and handle data events', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('data: {"type":"dd:ack","data":{"version":"1.0"}}\n\n'));

      expect(handleSpy).toHaveBeenCalledWith('dd:ack', { version: '1.0' });
    });

    test('should handle SSE data split across chunks', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      // Send message in two chunks
      stream.emit('data', Buffer.from('data: {"type":"dd:ac'));
      stream.emit('data', Buffer.from('k","data":{"version":"1.0"}}\n\n'));

      expect(handleSpy).toHaveBeenCalledWith('dd:ack', { version: '1.0' });
    });

    test('should handle malformed JSON in SSE data', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      stream.emit('data', Buffer.from('data: {invalid json}\n\n'));
    });

    test('should skip SSE lines that do not start with data:', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('event: test\nid: 123\n\n'));
      expect(handleSpy).not.toHaveBeenCalled();
    });

    test('should skip SSE data without type or data field', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('data: {"noType":true}\n\n'));
      expect(handleSpy).not.toHaveBeenCalled();
    });

    test('should reconnect on stream error', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('error', new Error('connection lost'));
      expect(reconnectSpy).toHaveBeenCalledWith(1000);
    });

    test('should reconnect on stream end', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('end');
      expect(reconnectSpy).toHaveBeenCalledWith(1000);
    });

    test('should reconnect on connection failure', async () => {
      axios.mockRejectedValue(new Error('connection refused'));

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      expect(reconnectSpy).toHaveBeenCalledWith(5000);
    });
  });

  describe('handleEvent', () => {
    test('should call handshake on dd:ack', async () => {
      const spy = vi.spyOn(client, 'handshake').mockResolvedValue(undefined);
      await client.handleEvent('dd:ack', { version: '1.0' });
      expect(spy).toHaveBeenCalled();
    });

    test('should process container on dd:container-added', async () => {
      const spy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      const container = { id: 'c1', name: 'test' };
      await client.handleEvent('dd:container-added', container);
      expect(spy).toHaveBeenCalledWith(container);
    });

    test('should process container on dd:container-updated', async () => {
      const spy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      const container = { id: 'c1', name: 'test' };
      await client.handleEvent('dd:container-updated', container);
      expect(spy).toHaveBeenCalledWith(container);
    });

    test('should delete container on dd:container-removed', async () => {
      await client.handleEvent('dd:container-removed', { id: 'c1' });
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
    });

    test('should ignore unknown event types', async () => {
      const processSpy = vi.spyOn(client, 'processContainer');
      await client.handleEvent('dd:unknown', {});
      expect(processSpy).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });
  });

  describe('runRemoteTrigger', () => {
    test('should post to remote trigger endpoint', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1' };
      await client.runRemoteTrigger(container, 'docker', 'update');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/triggers/docker/update'),
        container,
        expect.any(Object),
      );
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('trigger failed'));
      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'trigger failed',
      );
    });

    test('should encode path segments to prevent SSRF', async () => {
      axios.post.mockResolvedValue({ data: {} });
      await client.runRemoteTrigger({ id: 'c1' }, '../admin', '../../etc/passwd');
      const url = axios.post.mock.calls[0][0];
      expect(url).not.toContain('/../');
      expect(url).toContain(encodeURIComponent('../admin'));
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });

  describe('runRemoteTriggerBatch', () => {
    test('should post to remote batch trigger endpoint', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      await client.runRemoteTriggerBatch(containers, 'docker', 'update');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/triggers/docker/update/batch'),
        containers,
        expect.any(Object),
      );
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('batch failed'));
      await expect(client.runRemoteTriggerBatch([], 'docker', 'update')).rejects.toThrow(
        'batch failed',
      );
    });
  });

  describe('deleteContainer', () => {
    test('should delete container on agent', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('c1');
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/containers/c1'),
        expect.any(Object),
      );
    });

    test('should throw on failure', async () => {
      axios.delete.mockRejectedValue(new Error('delete failed'));
      await expect(client.deleteContainer('c1')).rejects.toThrow('delete failed');
    });

    test('should encode containerId to prevent SSRF', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('../../etc/passwd');
      const url = axios.delete.mock.calls[0][0];
      expect(url).not.toContain('/../');
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });

  describe('watch', () => {
    test('should post to watcher endpoint and process reports', async () => {
      const reports = [{ container: { id: 'c1' } }, { container: { id: 'c2' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);

      const result = await client.watch('docker', 'local');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/watchers/docker/local'),
        {},
        expect.any(Object),
      );
      expect(result).toBe(reports);
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(client.watch('docker', 'local')).rejects.toThrow('watch failed');
    });
  });

  describe('watchContainer', () => {
    test('should post to watcher container endpoint and process report', async () => {
      const report = { container: { id: 'c1' } };
      axios.post.mockResolvedValue({ data: report });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));

      const container = { id: 'c1', name: 'test' };
      const result = await client.watchContainer('docker', 'local', container);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/watchers/docker/local/container/c1'),
        {},
        expect.any(Object),
      );
      expect(result).toBe(report);
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(
        client.watchContainer('docker', 'local', { id: 'c1', name: 'test' }),
      ).rejects.toThrow('watch failed');
    });
  });

  describe('getLogEntries', () => {
    test('should fetch log entries with all params', async () => {
      axios.get.mockResolvedValue({ data: [{ msg: 'test' }] });
      const result = await client.getLogEntries({
        level: 'error',
        component: 'docker',
        tail: 100,
        since: 12345,
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/log/entries?level=error&component=docker&tail=100&since=12345',
        ),
        expect.any(Object),
      );
      expect(result).toEqual([{ msg: 'test' }]);
    });

    test('should fetch log entries with no params', async () => {
      axios.get.mockResolvedValue({ data: [] });
      const result = await client.getLogEntries();
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/log\/entries$/),
        expect.any(Object),
      );
      expect(result).toEqual([]);
    });

    test('should throw on failure', async () => {
      axios.get.mockRejectedValue(new Error('log fetch failed'));
      await expect(client.getLogEntries()).rejects.toThrow('log fetch failed');
    });
  });

  describe('getContainerLogs', () => {
    test('should fetch container logs with correct params', async () => {
      axios.get.mockResolvedValue({ data: { logs: 'hello world' } });
      const result = await client.getContainerLogs('c1', { tail: 100, since: 0, timestamps: true });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/containers/c1/logs?tail=100&since=0&timestamps=true'),
        expect.any(Object),
      );
      expect(result).toEqual({ logs: 'hello world' });
    });

    test('should throw on failure', async () => {
      axios.get.mockRejectedValue(new Error('logs failed'));
      await expect(
        client.getContainerLogs('c1', { tail: 100, since: 0, timestamps: true }),
      ).rejects.toThrow('logs failed');
    });

    test('should encode containerId to prevent path traversal', async () => {
      axios.get.mockResolvedValue({ data: { logs: '' } });
      await client.getContainerLogs('../../etc/passwd', { tail: 100, since: 0, timestamps: true });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });
});
