import {
  buildSystemLogStreamUrl,
  createSystemLogStreamConnection,
} from '@/services/system-log-stream';

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

describe('system-log-stream service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  describe('buildSystemLogStreamUrl', () => {
    it('uses ws protocol and default query values for http locations', () => {
      const url = buildSystemLogStreamUrl({}, {
        protocol: 'http:',
        host: 'localhost:3000',
      } as Location);

      expect(url).toBe('ws://localhost:3000/api/v1/log/stream?tail=100');
    });

    it('uses wss protocol and includes explicit query values', () => {
      const url = buildSystemLogStreamUrl({ level: 'warn', component: 'api', tail: 50 }, {
        protocol: 'https:',
        host: 'example.com',
      } as Location);

      expect(url).toBe('wss://example.com/api/v1/log/stream?level=warn&component=api&tail=50');
    });

    it('omits level param when set to all', () => {
      const url = buildSystemLogStreamUrl({ level: 'all' }, {
        protocol: 'http:',
        host: 'localhost:3000',
      } as Location);

      expect(url).toBe('ws://localhost:3000/api/v1/log/stream?tail=100');
    });

    it('omits component param when empty', () => {
      const url = buildSystemLogStreamUrl({ component: '' }, {
        protocol: 'http:',
        host: 'localhost:3000',
      } as Location);

      expect(url).toBe('ws://localhost:3000/api/v1/log/stream?tail=100');
    });
  });

  describe('createSystemLogStreamConnection', () => {
    it('opens socket and emits parsed log entries', () => {
      const onMessage = vi.fn();
      const onStatus = vi.fn();

      const connection = createSystemLogStreamConnection({
        onMessage,
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      const socket = MockWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage(
        '{"timestamp":1000,"displayTimestamp":"[00:00:01.000]","level":"info","component":"api","msg":"hello"}',
      );
      socket.emitMessage('{"invalid":"entry"}');
      socket.emitMessage('not-json');
      socket.emitMessage({ unexpected: true });
      socket.emitMessage('"primitive-json"');

      expect(onStatus).toHaveBeenCalledWith('connected');
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        timestamp: 1000,
        displayTimestamp: '[00:00:01.000]',
        level: 'info',
        component: 'api',
        msg: 'hello',
      });

      connection.close();
      expect(socket.close).toHaveBeenCalledWith(1000, 'manual-close');
    });

    it('supports update, pause, and resume lifecycle controls', () => {
      const connection = createSystemLogStreamConnection({
        onMessage: vi.fn(),
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      const firstSocket = MockWebSocket.instances[0];

      connection.update({ level: 'warn', tail: 500 });
      expect(firstSocket.close).toHaveBeenCalledWith(1000, 'reconnect');
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toContain('level=warn');
      expect(MockWebSocket.instances[1].url).toContain('tail=500');

      const secondSocket = MockWebSocket.instances[1];
      connection.pause();
      expect(secondSocket.close).toHaveBeenCalledWith(1000, 'pause');
      expect(connection.isPaused()).toBe(true);

      connection.resume();
      expect(MockWebSocket.instances).toHaveLength(3);
      expect(connection.isPaused()).toBe(false);
    });

    it('handles idempotent lifecycle no-op branches', () => {
      const connection = createSystemLogStreamConnection({
        onMessage: vi.fn(),
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      });

      // resume while active: no-op
      connection.resume();
      expect(MockWebSocket.instances).toHaveLength(1);

      // pause twice
      connection.pause();
      connection.pause();
      expect(connection.isPaused()).toBe(true);

      // update while paused: no-op (closed + reconnect skipped because paused)
      const pausedSocket = MockWebSocket.instances[0];
      connection.update({ tail: 999 });
      expect(pausedSocket.close).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances).toHaveLength(1);

      // close twice
      connection.close();
      connection.close();
    });

    it('notifies disconnected state on close/error while active', () => {
      const onStatus = vi.fn();

      createSystemLogStreamConnection({
        onMessage: vi.fn(),
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      });

      const socket = MockWebSocket.instances[0];
      socket.emitError();
      socket.emitClose(1011, 'boom');

      expect(onStatus).toHaveBeenCalledWith('disconnected');
    });

    it('does not notify disconnected when socket events happen after pause/close', () => {
      const onStatus = vi.fn();

      const connection = createSystemLogStreamConnection({
        onMessage: vi.fn(),
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
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

      const disconnectedCalls = onStatus.mock.calls.filter(([s]) => s === 'disconnected');
      expect(disconnectedCalls).toHaveLength(0);
    });

    it('ignores stale socket events after update-triggered reconnect', () => {
      const onStatus = vi.fn();
      const onMessage = vi.fn();

      const connection = createSystemLogStreamConnection({
        onMessage,
        onStatus,
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: { protocol: 'http:', host: 'localhost:3000' } as Location,
      });

      const firstSocket = MockWebSocket.instances[0];
      connection.update({ tail: 500 });
      const secondSocket = MockWebSocket.instances[1];

      firstSocket.emitOpen();
      firstSocket.emitMessage('{"timestamp":1000,"level":"info","component":"api","msg":"stale"}');
      firstSocket.emitClose(1000, 'stale-close');
      secondSocket.emitOpen();
      secondSocket.emitMessage('{"timestamp":2000,"level":"warn","component":"api","msg":"fresh"}');

      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith('connected');
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        timestamp: 2000,
        level: 'warn',
        component: 'api',
        msg: 'fresh',
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
        const connection = createSystemLogStreamConnection({
          onMessage: vi.fn(),
        });

        expect(urls).toHaveLength(1);
        const streamUrl = urls[0];
        const expectedProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        expect(streamUrl.startsWith(`${expectedProtocol}${window.location.host}`)).toBe(true);
        expect(streamUrl).toContain('/api/v1/log/stream?');

        connection.close();
      } finally {
        globalThis.WebSocket = originalWebSocket;
      }
    });
  });
});
