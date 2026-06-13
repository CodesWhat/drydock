/**
 * Tests for EdgeAgentAdapter frame dispatch.
 */
import { emitAgentConnected, emitAgentDisconnected } from '../event/index.js';
import { AgentClient } from './AgentClient.js';
import { EdgeAgentAdapter, type HelloMessage, type WebSocketLike } from './EdgeAgentAdapter.js';
import * as manager from './manager.js';

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../event/index.js', () => ({
  emitAgentConnected: vi.fn().mockResolvedValue(undefined),
  emitAgentDisconnected: vi.fn().mockResolvedValue(undefined),
  emitAgentStatsChanged: vi.fn().mockResolvedValue(undefined),
  emitContainerReport: vi.fn().mockResolvedValue(undefined),
  emitContainerReports: vi.fn().mockResolvedValue(undefined),
  emitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSecurityScanCycleComplete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./manager.js', () => ({
  addAgent: vi.fn(),
  removeAgent: vi.fn(),
  getAgent: vi.fn(() => undefined),
  getAgents: vi.fn(() => []),
}));

// Mock AgentClient to avoid real SSE/HTTP calls — use vi.hoisted so the class
// is available when vi.mock factory runs (factories are hoisted to top of file).
const { MockAgentClient } = vi.hoisted(() => {
  class _MockAgentClient {
    name: string;
    config: { host: string; port: number; secret: string };
    isConnected = false;
    info: Record<string, unknown> = {};
    handleEvent = vi.fn().mockResolvedValue(undefined);
    handleContainerSync = vi.fn().mockResolvedValue(undefined);
    handleComponentSync = vi.fn().mockResolvedValue(undefined);
    scheduleStatsChangedPublic = vi.fn();
    stop = vi.fn();

    constructor(name: string) {
      this.name = name;
      this.config = { host: 'http://edge-agent-placeholder', port: 0, secret: '' };
    }
  }
  return { MockAgentClient: _MockAgentClient };
});

vi.mock('./AgentClient.js', () => ({
  AgentClient: MockAgentClient,
}));

function createMockWs(): WebSocketLike & {
  sentMessages: string[];
  closedWith: [number, string] | undefined;
  listeners: Map<string, ((...args: unknown[]) => void)[]>;
  emit: (event: string, ...args: unknown[]) => void;
} {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const sentMessages: string[] = [];
  let closedWith: [number, string] | undefined;

  return {
    sentMessages,
    closedWith,
    listeners,
    send: vi.fn((data: string) => {
      sentMessages.push(data);
    }),
    close: vi.fn((code?: number, reason?: string) => {
      closedWith = [code ?? 1000, reason ?? ''];
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    }),
    off: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      const eventListeners = listeners.get(event) ?? [];
      for (const listener of eventListeners) {
        listener(...args);
      }
    },
  };
}

function createHello(overrides: Partial<HelloMessage> = {}): HelloMessage {
  return {
    version: '0.2.0',
    protocol: 'lookout/1.0',
    agentId: 'test-agent-id-1234',
    agentName: 'test-agent',
    dockerVersion: '27.0.0',
    hostname: 'test-host',
    capabilities: ['compose', 'exec', 'metrics', 'events'],
    drydockCompat: '1.4.0',
    pubKeyId: 'aabbccddeeff0011',
    timestamp: Math.floor(Date.now() / 1000),
    nonce: 'a'.repeat(32),
    signature: 'dGVzdA',
    ...overrides,
  };
}

function createAdapter(hello?: Partial<HelloMessage>) {
  const ws = createMockWs();
  const helloMsg = createHello(hello);
  const client = new AgentClient(`lookout-edge-${helloMsg.agentId}`, {
    host: 'http://edge-agent-placeholder',
    port: 0,
    secret: '',
  });
  const adapter = new EdgeAgentAdapter(client, ws, helloMsg, {
    pollInterval: 300,
    agentId: helloMsg.agentId,
    version: helloMsg.version,
  });
  return { adapter, ws, client, hello: helloMsg };
}

function sendFrame(ws: ReturnType<typeof createMockWs>, type: string, data: unknown) {
  ws.emit('message', JSON.stringify({ type, data }));
}

describe('EdgeAgentAdapter — activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('calls addAgent and registers message/close/error listeners', () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(manager.addAgent).toHaveBeenCalled();
    expect(ws.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('EdgeAgentAdapter — frame dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('dd:container_sync calls handleContainerSync with containers array', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const containers = [{ id: 'c1', name: 'test' }];
    sendFrame(ws, 'dd:container_sync', { containers });

    await new Promise((r) => setTimeout(r, 0));

    expect((client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync).toHaveBeenCalledWith(containers);
  });

  test('dd:component_sync calls handleComponentSync', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const watchers = [{ type: 'docker', name: 'local', configuration: {} }];
    const triggers = [{ type: 'docker', name: 'update', configuration: {} }];
    sendFrame(ws, 'dd:component_sync', { watchers, triggers });

    await new Promise((r) => setTimeout(r, 0));

    expect((client as unknown as { handleComponentSync: ReturnType<typeof vi.fn> }).handleComponentSync).toHaveBeenCalledWith(watchers, triggers);
  });

  test('dd:container_added reaches handleEvent with hyphenated name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const container = { id: 'c1', name: 'test' };
    sendFrame(ws, 'dd:container_added', { container });

    await new Promise((r) => setTimeout(r, 0));

    expect((client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent).toHaveBeenCalledWith('dd:container-added', container);
  });

  test('dd:container_updated reaches handleEvent with hyphenated name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const container = { id: 'c1', name: 'test' };
    sendFrame(ws, 'dd:container_updated', { container });

    await new Promise((r) => setTimeout(r, 0));

    expect((client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent).toHaveBeenCalledWith('dd:container-updated', container);
  });

  test('dd:container_removed reaches handleEvent with id and name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_removed', { id: 'c1', name: 'test' });

    await new Promise((r) => setTimeout(r, 0));

    expect((client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent).toHaveBeenCalledWith('dd:container-removed', { id: 'c1', name: 'test' });
  });

  test('metrics frame updates client.info', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'metrics', {
      cpuUsage: 0.5,
      cpuCores: 4,
      memoryTotal: 8 * 1e9,
      memoryUsed: 4 * 1e9,
      uptime: 3600,
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(client.info.memoryGb).toBeCloseTo(8, 1);
    expect(client.info.uptimeSeconds).toBe(3600);
    expect(client.info.lastSeen).toBeTruthy();
    expect((client as unknown as { scheduleStatsChangedPublic: ReturnType<typeof vi.fn> }).scheduleStatsChangedPublic).toHaveBeenCalled();
  });

  test('ping frame sends pong with same timestamp', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'ping', { timestamp: 12345678 });

    await new Promise((r) => setTimeout(r, 0));

    expect(ws.sentMessages.some((m) => {
      const parsed = JSON.parse(m) as { type: string; data: { timestamp: number } };
      return parsed.type === 'pong' && parsed.data.timestamp === 12345678;
    })).toBe(true);
  });

  test('pong frame is a no-op (no exception)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() => sendFrame(ws, 'pong', { timestamp: 12345678 })).not.toThrow();
  });

  test('dd:watch_response is logged at debug without exception', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() =>
      sendFrame(ws, 'dd:watch_response', { watcherType: 'docker', watcherName: 'local', results: [] }),
    ).not.toThrow();
  });

  test('exec_ready stores session in execSessions', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_ready', { execId: 'exec-001' });
    await new Promise((r) => setTimeout(r, 0));

    // The session should be tracked; verifiable by exec_end removing it
    sendFrame(ws, 'exec_end', { execId: 'exec-001' });
    await new Promise((r) => setTimeout(r, 0));

    // No errors thrown — session was found and cleaned up
    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_output routes to output handler callback', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const outputBytes: Buffer[] = [];
    sendFrame(ws, 'exec_ready', { execId: 'exec-002' });
    await new Promise((r) => setTimeout(r, 0));

    // Manually wire an output handler through the adapter internals
    // by checking the ExecSession structure
    const data = Buffer.from('hello world');
    const encoded = data.toString('base64');

    // Access private execSessions for test
    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, { execId: string; outputHandler?: (buf: Buffer) => void; close: () => void }>;
    };
    const session = adapterInternal.execSessions.get('exec-002');
    if (session) {
      session.outputHandler = (buf: Buffer) => {
        outputBytes.push(buf);
      };
    }

    sendFrame(ws, 'exec_output', { execId: 'exec-002', data: encoded });
    await new Promise((r) => setTimeout(r, 0));

    expect(outputBytes).toHaveLength(1);
    expect(outputBytes[0].toString()).toBe('hello world');
  });

  test('exec_end removes session from execSessions', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_ready', { execId: 'exec-003' });
    await new Promise((r) => setTimeout(r, 0));

    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, unknown>;
    };
    expect(adapterInternal.execSessions.has('exec-003')).toBe(true);

    sendFrame(ws, 'exec_end', { execId: 'exec-003' });
    await new Promise((r) => setTimeout(r, 0));

    expect(adapterInternal.execSessions.has('exec-003')).toBe(false);
  });

  test('response frame resolves pending request', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const requestPromise = adapter.sendRequest('GET', '/api/containers');

    // Find the requestId from the sent frame
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    sendFrame(ws, 'response', { requestId, statusCode: 200, body: [] });
    await new Promise((r) => setTimeout(r, 0));

    const result = await requestPromise;
    expect((result as { statusCode: number }).statusCode).toBe(200);
  });

  test('exec start when limit reached sends exec_end frame, does not close connection', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, { execId: string; outputHandler?: (buf: Buffer) => void; close: () => void }>;
    };

    // Fill execSessions to limit
    for (let i = 0; i < 100; i++) {
      adapterInternal.execSessions.set(`exec-fill-${i}`, {
        execId: `exec-fill-${i}`,
        close: () => adapterInternal.execSessions.delete(`exec-fill-${i}`),
      });
    }

    await adapter.startExec('c1', ['/bin/bash']).catch(() => {});

    const lastSent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { reason: string };
    };
    expect(lastSent.type).toBe('exec_end');
    expect(lastSent.data.reason).toBe('session limit reached');
    expect(ws.close).not.toHaveBeenCalled();
  });

  test('sendRequest rejects after 30s timeout', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const requestPromise = adapter.sendRequest('GET', '/api/test');

    vi.advanceTimersByTime(31_000);
    await expect(requestPromise).rejects.toThrow(/timed out/);

    vi.useRealTimers();
  });
});

describe('EdgeAgentAdapter — disconnect cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('onDisconnect rejects all pending requests', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const p1 = adapter.sendRequest('GET', '/api/test').catch((err: Error) => err.message);

    await adapter.onDisconnect();

    expect(await p1).toMatch(/connection closed/);
  });

  test('onDisconnect clears all exec sessions', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_ready', { execId: 'exec-99' });
    await new Promise((r) => setTimeout(r, 0));

    const adapterInternal = adapter as unknown as { execSessions: Map<string, unknown> };
    expect(adapterInternal.execSessions.size).toBe(1);

    await adapter.onDisconnect();

    expect(adapterInternal.execSessions.size).toBe(0);
  });

  test('onDisconnect calls removeAgent', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    await adapter.onDisconnect();

    expect(manager.removeAgent).toHaveBeenCalled();
  });

  test('onDisconnect emits agentDisconnected when was connected', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Mark as connected by simulating container_sync
    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 0));

    // Manually set connected state for this test
    (adapter as unknown as { connected: boolean }).connected = true;
    client.isConnected = true;

    await adapter.onDisconnect();

    expect(emitAgentDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'WebSocket closed' }),
    );
  });

  test('ws close event triggers onDisconnect', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    ws.emit('close');
    await new Promise((r) => setTimeout(r, 10));

    expect(manager.removeAgent).toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — dd:container_sync sets connected state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('emits agentConnected on first container_sync', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(emitAgentConnected).toHaveBeenCalledWith(
      expect.objectContaining({ reconnected: false }),
    );
  });

  test('does not emit agentConnected twice', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 0));
    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(emitAgentConnected).toHaveBeenCalledTimes(1);
  });
});
