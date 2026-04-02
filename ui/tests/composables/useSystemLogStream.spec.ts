import { effectScope } from 'vue';
import { useSystemLogStream } from '@/composables/useSystemLogStream';
import {
  createSystemLogStreamConnection,
  type SystemLogEntry,
  type SystemLogStreamConnection,
  type SystemLogStreamQuery,
} from '@/services/system-log-stream';

vi.mock('@/services/system-log-stream', () => ({
  createSystemLogStreamConnection: vi.fn(),
}));

interface MockConnectionRecord {
  close: ReturnType<typeof vi.fn<() => void>>;
  onMessage: (entry: SystemLogEntry) => void;
  onStatus?: (status: 'connected' | 'disconnected') => void;
  pause: ReturnType<typeof vi.fn<() => void>>;
  query: Record<string, unknown> | undefined;
  resume: ReturnType<typeof vi.fn<() => void>>;
  update: ReturnType<typeof vi.fn<(query: Partial<SystemLogStreamQuery>) => void>>;
}

const mockCreateSystemLogStreamConnection = vi.mocked(createSystemLogStreamConnection);

function makeEntry(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    timestamp: Date.now(),
    displayTimestamp: '08:00:00.000',
    level: 'info',
    component: 'drydock',
    msg: 'test message',
    ...overrides,
  };
}

describe('useSystemLogStream', () => {
  const mockLocation = { protocol: 'http:', host: 'localhost:3000' } as Location;
  let connections: MockConnectionRecord[];

  beforeEach(() => {
    vi.clearAllMocks();
    connections = [];

    mockCreateSystemLogStreamConnection.mockImplementation((options) => {
      const record: MockConnectionRecord = {
        close: vi.fn<() => void>(),
        onMessage: options.onMessage,
        onStatus: options.onStatus,
        pause: vi.fn<() => void>(),
        query: options.query as Record<string, unknown> | undefined,
        resume: vi.fn<() => void>(),
        update: vi.fn<(query: Partial<SystemLogStreamQuery>) => void>(),
      };
      connections.push(record);
      return {
        update: record.update,
        pause: record.pause,
        resume: record.resume,
        close: record.close,
        isPaused: () => false,
      } satisfies SystemLogStreamConnection;
    });
  });

  it('starts disconnected with empty entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      expect(entries.value).toEqual([]);
      expect(status.value).toBe('disconnected');
      expect(connections).toHaveLength(0);
    });
    scope.stop();
  });

  it('connects and receives entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status, connect } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect({ level: 'info', tail: 50 });

      expect(connections).toHaveLength(1);
      expect(connections[0].query).toEqual({ level: 'info', tail: 50 });

      connections[0].onStatus?.('connected');
      connections[0].onMessage(makeEntry({ msg: 'entry-1' }));
      connections[0].onMessage(makeEntry({ msg: 'entry-2' }));

      expect(status.value).toBe('connected');
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
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect();

      for (let i = 0; i < 2010; i++) {
        connections[0].onMessage(makeEntry({ msg: `msg-${i}` }));
      }

      expect(entries.value).toHaveLength(2000);
      expect(entries.value[0].msg).toBe('msg-10');
      expect(entries.value[entries.value.length - 1].msg).toBe('msg-2009');
    });
    scope.stop();
  });

  it('reconnects by closing the previous connection and clearing entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, connect } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect({ level: 'info' });
      connections[0].onMessage(makeEntry({ msg: 'before-reconnect' }));
      expect(entries.value).toHaveLength(1);

      connect({ level: 'warn', tail: 200 });

      expect(connections[0].close).toHaveBeenCalledTimes(1);
      expect(connections).toHaveLength(2);
      expect(connections[1].query).toEqual({ level: 'warn', tail: 200 });
      expect(entries.value).toEqual([]);
    });
    scope.stop();
  });

  it('disconnects and resets status', () => {
    const scope = effectScope();
    scope.run(() => {
      const { status, connect, disconnect } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect();
      connections[0].onStatus?.('connected');

      disconnect();

      expect(status.value).toBe('disconnected');
      expect(connections[0].close).toHaveBeenCalledTimes(1);
    });
    scope.stop();
  });

  it('updateFilters delegates to the active connection and clears entries', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, updateFilters, connect } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect({ level: 'info' });
      connections[0].onMessage(makeEntry({ msg: 'old-entry' }));
      expect(entries.value).toHaveLength(1);

      updateFilters({ level: 'warn', tail: 200 });

      expect(entries.value).toEqual([]);
      expect(mockCreateSystemLogStreamConnection).toHaveBeenCalledTimes(1);
      expect(connections[0].update).toHaveBeenCalledWith({ level: 'warn', tail: 200 });
    });
    scope.stop();
  });

  it('updateFilters creates a new connection when none exists', () => {
    const scope = effectScope();
    scope.run(() => {
      const { updateFilters } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      updateFilters({ level: 'error' });

      expect(connections).toHaveLength(1);
      expect(connections[0].query).toEqual({ level: 'error' });
    });
    scope.stop();
  });

  it('clear empties entries without disconnecting', () => {
    const scope = effectScope();
    scope.run(() => {
      const { entries, status, connect, clear } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect();
      connections[0].onStatus?.('connected');
      connections[0].onMessage(makeEntry({ msg: 'to-clear' }));
      expect(entries.value).toHaveLength(1);

      clear();

      expect(entries.value).toEqual([]);
      expect(status.value).toBe('connected');
      expect(connections[0].close).not.toHaveBeenCalled();
    });
    scope.stop();
  });

  it('auto-disconnects on scope dispose', () => {
    const scope = effectScope();

    scope.run(() => {
      const { connect } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      connect();
    });

    scope.stop();
    expect(connections[0].close).toHaveBeenCalledTimes(1);
  });

  it('handles disconnect when no connection exists', () => {
    const scope = effectScope();
    scope.run(() => {
      const { disconnect, status } = useSystemLogStream({
        webSocketFactory: vi.fn() as unknown as (url: string) => WebSocket,
        location: mockLocation,
      });

      disconnect();

      expect(status.value).toBe('disconnected');
      expect(connections).toHaveLength(0);
    });
    scope.stop();
  });
});
