import { effectScope } from 'vue';
import { useSystemLogStream } from '@/composables/useSystemLogStream';

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

function makeEntryPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    timestamp: Date.now(),
    level: 'info',
    component: 'drydock',
    msg: 'test message',
    ...overrides,
  });
}

describe('useSystemLogStream', () => {
  const mockLocation = { protocol: 'http:', host: 'localhost:3000' } as Location;

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  it('starts disconnected with empty entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      expect(entries.value).toEqual([]);
      expect(status.value).toBe('disconnected');
    });
    scope.stop();
  });

  it('connects and receives entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status, connect } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect({ level: 'info', tail: 50 });

      const socket = MockWebSocket.instances[0];
      socket.emitOpen();
      expect(status.value).toBe('connected');

      socket.emitMessage(makeEntryPayload({ msg: 'entry-1' }));
      socket.emitMessage(makeEntryPayload({ msg: 'entry-2' }));

      expect(entries.value).toHaveLength(2);
      expect(entries.value[0].msg).toBe('entry-1');
      expect(entries.value[1].msg).toBe('entry-2');
    });
    scope.stop();
  });

  it('caps entries at 2000', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, connect } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect();

      const socket = MockWebSocket.instances[0];
      socket.emitOpen();

      for (let i = 0; i < 2010; i++) {
        socket.emitMessage(makeEntryPayload({ msg: `msg-${i}` }));
      }

      expect(entries.value).toHaveLength(2000);
      // Oldest entries should be dropped
      expect(entries.value[0].msg).toBe('msg-10');
      expect(entries.value[entries.value.length - 1].msg).toBe('msg-2009');
    });
    scope.stop();
  });

  it('disconnects and clears entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status, connect, disconnect } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect();
      const socket = MockWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage(makeEntryPayload({ msg: 'before-disconnect' }));

      disconnect();
      expect(status.value).toBe('disconnected');
      expect(socket.close).toHaveBeenCalledWith(1000, 'manual-close');
    });
    scope.stop();
  });

  it('updateFilters reconnects with new query and clears entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, updateFilters, connect } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect({ level: 'info' });
      const socket1 = MockWebSocket.instances[0];
      socket1.emitOpen();
      socket1.emitMessage(makeEntryPayload({ msg: 'old-entry' }));
      expect(entries.value).toHaveLength(1);

      updateFilters({ level: 'warn', tail: 200 });
      expect(entries.value).toHaveLength(0);
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toContain('level=warn');
      expect(MockWebSocket.instances[1].url).toContain('tail=200');
    });
    scope.stop();
  });

  it('updateFilters creates a new connection when none exists', () => {
    const scope = effectScope();
    scope.run(() => {
      const { updateFilters } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      updateFilters({ level: 'error' });
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toContain('level=error');
    });
    scope.stop();
  });

  it('clear empties entries without disconnecting', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status, connect, clear } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect();
      const socket = MockWebSocket.instances[0];
      socket.emitOpen();
      socket.emitMessage(makeEntryPayload({ msg: 'to-clear' }));
      expect(entries.value).toHaveLength(1);

      clear();
      expect(entries.value).toHaveLength(0);
      expect(status.value).toBe('connected');
    });
    scope.stop();
  });

  it('auto-disconnects on scope dispose', () => {
    const scope = effectScope();
    let closeRef: ReturnType<typeof vi.fn> | undefined;

    scope.run(() => {
      const { connect } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      connect();
      closeRef = MockWebSocket.instances[0].close;
    });

    scope.stop();
    expect(closeRef).toHaveBeenCalledWith(1000, 'manual-close');
  });

  it('handles disconnect when no connection exists', () => {
    const scope = effectScope();
    scope.run(() => {
      const { disconnect, status } = useSystemLogStream({
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
        location: mockLocation,
      });

      // Should not throw
      disconnect();
      expect(status.value).toBe('disconnected');
    });
    scope.stop();
  });
});
