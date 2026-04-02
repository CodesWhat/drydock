import {
  buildContainerLogStreamUrl,
  createContainerLogStreamConnection,
  downloadContainerLogs,
  toLogTailValue,
} from '@/services/logs';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.onopen?.(new Event('open'));
  }

  emitMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: payload as string }));
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }

  emitClose(code = 1000, reason = 'normal') {
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('logs service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    global.fetch = vi.fn();
  });

  describe('buildContainerLogStreamUrl', () => {
    it('uses ws protocol and default query values for http locations', () => {
      const url = buildContainerLogStreamUrl('abc/def', {}, {
        protocol: 'http:',
        host: 'localhost:3000',
      } as Location);

      expect(url).toBe(
        'ws://localhost:3000/api/v1/containers/abc%2Fdef/logs/stream?stdout=true&stderr=true&tail=100&follow=true',
      );
    });

    it('uses wss protocol and includes explicit query values', () => {
      const url = buildContainerLogStreamUrl(
        'container-1',
        {
          stdout: false,
          stderr: true,
          tail: 'all',
          since: '2026-03-15T00:00:00Z',
          follow: false,
        },
        {
          protocol: 'https:',
          host: 'example.com',
        } as Location,
      );

      expect(url).toBe(
        'wss://example.com/api/v1/containers/container-1/logs/stream?stdout=false&stderr=true&tail=2147483647&since=2026-03-15T00%3A00%3A00Z&follow=false',
      );
    });
  });

  describe('createContainerLogStreamConnection', () => {
    it('opens socket and emits parsed messages', () => {
      const onMessage = vi.fn();
      const onStatus = vi.fn();

      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage,
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      const socket = MockWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage('{"type":"stdout","ts":"2026-03-15T00:00:00Z","line":"hello"}');
      socket.emitMessage('{"type":"invalid","ts":"2026-03-15T00:00:00Z","line":"ignored"}');
      socket.emitMessage('"primitive-json"');
      socket.emitMessage({ unexpected: true });
      socket.emitMessage('not-json');

      expect(onStatus).toHaveBeenCalledWith('connected');
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        type: 'stdout',
        ts: '2026-03-15T00:00:00Z',
        line: 'hello',
      });

      connection.close();
      expect(socket.close).toHaveBeenCalledWith(1000, 'manual-close');
    });

    it('ignores frames with invalid display timestamp metadata', () => {
      const onMessage = vi.fn();

      createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      const socket = MockWebSocket.instances[0];
      socket.emitMessage(
        '{"type":"stdout","ts":"2026-03-15T00:00:00Z","displayTs":123,"line":"ignored"}',
      );

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('supports update, pause, and resume lifecycle controls', () => {
      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage: vi.fn(),
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      const firstSocket = MockWebSocket.instances[0];

      connection.update({ tail: 500, stdout: false });
      expect(firstSocket.close).toHaveBeenCalledWith(1000, 'reconnect');
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toContain('tail=500');
      expect(MockWebSocket.instances[1].url).toContain('stdout=false');

      const secondSocket = MockWebSocket.instances[1];
      connection.pause();
      expect(secondSocket.close).toHaveBeenCalledWith(1000, 'pause');
      expect(connection.isPaused()).toBe(true);

      connection.resume();
      expect(MockWebSocket.instances).toHaveLength(3);
      expect(connection.isPaused()).toBe(false);
    });

    it('handles idempotent lifecycle no-op branches', () => {
      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage: vi.fn(),
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      // resume while active: no-op
      connection.resume();
      expect(MockWebSocket.instances).toHaveLength(1);

      // pause twice: second call is no-op branch
      connection.pause();
      connection.pause();
      expect(connection.isPaused()).toBe(true);

      // update while paused: no-op branch
      const pausedSocket = MockWebSocket.instances[0];
      connection.update({ tail: 999 });
      expect(pausedSocket.close).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances).toHaveLength(1);

      // close twice: second call is no-op branch
      connection.close();
      connection.close();
    });

    it('notifies disconnected state on close/error while active', () => {
      const onStatus = vi.fn();

      createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage: vi.fn(),
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      const socket = MockWebSocket.instances[0];
      socket.emitError();
      socket.emitClose(1011, 'boom');

      expect(onStatus).toHaveBeenCalledWith('disconnected');
    });

    it('does not notify disconnected when socket events happen after pause/close', () => {
      const onStatus = vi.fn();

      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage: vi.fn(),
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      const firstSocket = MockWebSocket.instances[0];
      connection.pause();
      firstSocket.emitError();
      firstSocket.emitClose(1011, 'paused-close');

      connection.resume();
      const resumedSocket = MockWebSocket.instances[1];
      connection.close();
      resumedSocket.emitError();
      resumedSocket.emitClose(1011, 'closed-close');

      const disconnectedCalls = onStatus.mock.calls.filter(([status]) => status === 'disconnected');
      expect(disconnectedCalls).toHaveLength(0);
    });

    it('ignores stale socket close events after update-triggered reconnect', () => {
      const onStatus = vi.fn();

      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage: vi.fn(),
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      const firstSocket = MockWebSocket.instances[0];
      connection.update({ tail: 500 });
      firstSocket.emitClose(1000, 'stale-close');

      const disconnectedCalls = onStatus.mock.calls.filter(([status]) => status === 'disconnected');
      expect(disconnectedCalls).toHaveLength(0);
    });

    it('ignores stale socket open and message events after update-triggered reconnect', () => {
      const onStatus = vi.fn();
      const onMessage = vi.fn();

      const connection = createContainerLogStreamConnection({
        containerId: 'container-1',
        onMessage,
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: {
          protocol: 'http:',
          host: 'localhost:3000',
        } as Location,
      });

      const firstSocket = MockWebSocket.instances[0];
      connection.update({ tail: 500 });
      const secondSocket = MockWebSocket.instances[1];

      firstSocket.emitOpen();
      firstSocket.emitMessage('{"type":"stdout","ts":"2026-03-15T00:00:00Z","line":"stale"}');
      secondSocket.emitOpen();
      secondSocket.emitMessage('{"type":"stderr","ts":"2026-03-15T00:00:01Z","line":"fresh"}');

      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith('connected');
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        type: 'stderr',
        ts: '2026-03-15T00:00:01Z',
        line: 'fresh',
      });
    });

    it('uses default browser websocket factory and location when options are omitted', () => {
      const originalWebSocket = globalThis.WebSocket;
      const urls: string[] = [];
      class NativeWebSocketMock extends MockWebSocket {
        constructor(url: string) {
          super(url);
          urls.push(url);
        }
      }
      globalThis.WebSocket = NativeWebSocketMock as unknown as typeof WebSocket;

      try {
        const connection = createContainerLogStreamConnection({
          containerId: 'container-1',
          onMessage: vi.fn(),
        });

        expect(urls).toHaveLength(1);
        const streamUrl = urls[0];
        const expectedProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        expect(streamUrl.startsWith(`${expectedProtocol}${window.location.host}`)).toBe(true);
        expect(streamUrl).toContain('/api/v1/containers/container-1/logs/stream?');

        connection.close();
      } finally {
        globalThis.WebSocket = originalWebSocket;
      }
    });
  });

  describe('downloadContainerLogs', () => {
    it('requests plain text log download and returns blob payload', async () => {
      const blob = new Blob(['log payload'], { type: 'text/plain' });
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        blob: async () => blob,
      } as Response);

      const result = await downloadContainerLogs('container-1', {
        stdout: true,
        stderr: false,
        tail: 1000,
        since: '2026-03-15T00:00:00Z',
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/containers/container-1/logs?stdout=true&stderr=false&tail=1000&since=2026-03-15T00%3A00%3A00Z',
        {
          credentials: 'include',
          headers: {
            Accept: 'text/plain',
          },
        },
      );
      expect(result).toBe(blob);
    });

    it('throws on unsuccessful download response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      } as Response);

      await expect(downloadContainerLogs('container-1')).rejects.toThrow(
        'Failed to download logs for container container-1: Unauthorized',
      );
    });
  });

  describe('toLogTailValue', () => {
    it('maps all tail option to large integer for backend compatibility', () => {
      expect(toLogTailValue('all')).toBe(2147483647);
      expect(toLogTailValue(100)).toBe(100);
    });
  });
});
