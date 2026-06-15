/**
 * Tests for EdgeAgentAdapter frame dispatch.
 */
import { emitAgentConnected, emitAgentDisconnected } from '../event/index.js';
import { AgentClient } from './AgentClient.js';
import {
  buildEdgeSentinelConfig,
  EdgeAgentAdapter,
  type HelloMessage,
  type WebSocketLike,
} from './EdgeAgentAdapter.js';
import * as manager from './manager.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
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
    protocol: 'portwing/1.0',
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
  const client = new AgentClient(`portwing-edge-${helloMsg.agentId}`, {
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

    expect(
      (client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync,
    ).toHaveBeenCalledWith(containers);
  });

  test('dd:component_sync calls handleComponentSync', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const watchers = [{ type: 'docker', name: 'local', configuration: {} }];
    const triggers = [{ type: 'docker', name: 'update', configuration: {} }];
    sendFrame(ws, 'dd:component_sync', { watchers, triggers });

    await new Promise((r) => setTimeout(r, 0));

    expect(
      (client as unknown as { handleComponentSync: ReturnType<typeof vi.fn> }).handleComponentSync,
    ).toHaveBeenCalledWith(watchers, triggers);
  });

  test('dd:container_added reaches handleEvent with hyphenated name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const container = { id: 'c1', name: 'test' };
    sendFrame(ws, 'dd:container_added', { container });

    await new Promise((r) => setTimeout(r, 0));

    expect(
      (client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent,
    ).toHaveBeenCalledWith('dd:container-added', container);
  });

  test('dd:container_updated reaches handleEvent with hyphenated name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    const container = { id: 'c1', name: 'test' };
    sendFrame(ws, 'dd:container_updated', { container });

    await new Promise((r) => setTimeout(r, 0));

    expect(
      (client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent,
    ).toHaveBeenCalledWith('dd:container-updated', container);
  });

  test('dd:container_removed reaches handleEvent with id and name', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_removed', { id: 'c1', name: 'test' });

    await new Promise((r) => setTimeout(r, 0));

    expect(
      (client as unknown as { handleEvent: ReturnType<typeof vi.fn> }).handleEvent,
    ).toHaveBeenCalledWith('dd:container-removed', { id: 'c1', name: 'test' });
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
    expect(
      (client as unknown as { scheduleStatsChangedPublic: ReturnType<typeof vi.fn> })
        .scheduleStatsChangedPublic,
    ).toHaveBeenCalled();
  });

  test('ping frame sends pong with same timestamp', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'ping', { timestamp: 12345678 });

    await new Promise((r) => setTimeout(r, 0));

    expect(
      ws.sentMessages.some((m) => {
        const parsed = JSON.parse(m) as { type: string; data: { timestamp: number } };
        return parsed.type === 'pong' && parsed.data.timestamp === 12345678;
      }),
    ).toBe(true);
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
      sendFrame(ws, 'dd:watch_response', {
        watcherType: 'docker',
        watcherName: 'local',
        results: [],
      }),
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
      execSessions: Map<
        string,
        { execId: string; outputHandler?: (buf: Buffer) => void; close: () => void }
      >;
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

  test('exec start when limit reached rejects with session-limit error and sends NO exec_end frame', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      execSessions: Map<
        string,
        { execId: string; outputHandler?: (buf: Buffer) => void; close: () => void }
      >;
    };

    // Fill execSessions to limit
    for (let i = 0; i < 100; i++) {
      adapterInternal.execSessions.set(`exec-fill-${i}`, {
        execId: `exec-fill-${i}`,
        close: () => adapterInternal.execSessions.delete(`exec-fill-${i}`),
      });
    }

    const sentCountBefore = ws.sentMessages.length;

    await expect(adapter.startExec('c1', ['/bin/bash'])).rejects.toThrow('session limit reached');

    // No new frame should have been sent — the exec_end send is spurious and has been removed
    expect(ws.sentMessages.length).toBe(sentCountBefore);
    expect(ws.close).not.toHaveBeenCalled();
  });

  test('sendRequest rejects after 30s timeout', async () => {
    vi.useFakeTimers();
    const { adapter } = createAdapter();
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
    const { adapter } = createAdapter();
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

describe('EdgeAgentAdapter — sendStreamRequest / stream frames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stream_end frame resolves promise registered by sendStreamRequest', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');

    // Extract the requestId from the sent request frame
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Simulate partial stream data
    sendFrame(ws, 'stream', { requestId, data: 'chunk-1' });
    await new Promise((r) => setTimeout(r, 0));

    // Simulate stream end
    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    expect((result as { complete: boolean; reason: string }).complete).toBe(true);
    expect((result as { complete: boolean; reason: string }).reason).toBe('done');
  });

  test('sendStreamRequest timeout rejects after 30s', async () => {
    vi.useFakeTimers();
    const { adapter } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');

    vi.advanceTimersByTime(31_000);
    await expect(streamPromise).rejects.toThrow(/timed out/);

    vi.useRealTimers();
  });

  test('error frame for a streaming request rejects the promise promptly (no 30s timeout)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    // Attach rejection handler immediately so the promise is never "unhandled"
    const rejection = streamPromise.catch((err: Error) => err.message);

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Agent replies with an error frame using the bare requestId (as the protocol specifies),
    // but the pending entry was registered under `stream:${requestId}`.
    // The fix must find it via the stream: prefix and reject immediately — no timeout needed.
    sendFrame(ws, 'error', { requestId, message: 'stream request failed' });
    await new Promise((r) => setTimeout(r, 0));

    // Must reject with the error message without waiting 30s
    expect(await rejection).toBe('stream request failed');

    // Verify the pending entry was cleaned up
    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };
    expect(adapterInternal.pendingRequests.size).toBe(0);
  });

  test('stream frame without stream_end does not resolve the promise', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    let resolved = false;
    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    streamPromise
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    sendFrame(ws, 'stream', { requestId: sentFrame.data.requestId, data: 'chunk' });
    await new Promise((r) => setTimeout(r, 0));

    expect(resolved).toBe(false);
    // Clean up by disconnecting to avoid timer leaks
    await adapter.onDisconnect();
  });
});

describe('EdgeAgentAdapter — exec stdin/resize (sendInput, sendResize)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sendInput sends exec_input frame with base64-encoded data', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const execId = await adapter.startExec('c1', ['/bin/bash']);
    // Clear start frame from sentMessages tracking
    ws.sentMessages.length = 0;

    const stdin = Buffer.from('hello\n');
    adapter.sendInput(execId, stdin);

    expect(ws.sentMessages).toHaveLength(1);
    const frame = JSON.parse(ws.sentMessages[0]) as {
      type: string;
      data: { execId: string; data: string };
    };
    expect(frame.type).toBe('exec_input');
    expect(frame.data.execId).toBe(execId);
    // data must be base64-encoded stdin
    expect(Buffer.from(frame.data.data, 'base64').toString()).toBe('hello\n');
  });

  test('sendResize sends exec_resize frame with cols and rows', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const execId = await adapter.startExec('c1', ['/bin/bash']);
    ws.sentMessages.length = 0;

    adapter.sendResize(execId, 120, 40);

    expect(ws.sentMessages).toHaveLength(1);
    const frame = JSON.parse(ws.sentMessages[0]) as {
      type: string;
      data: { execId: string; cols: number; rows: number };
    };
    expect(frame.type).toBe('exec_resize');
    expect(frame.data.execId).toBe(execId);
    expect(frame.data.cols).toBe(120);
    expect(frame.data.rows).toBe(40);
  });
});

describe('EdgeAgentAdapter — exec outputCallback via startExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('outputCallback passed to startExec receives exec_output bytes', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const received: Buffer[] = [];
    const execId = await adapter.startExec('c1', ['/bin/bash'], {
      outputCallback: (buf) => received.push(buf),
    });

    const payload = Buffer.from('from container');
    sendFrame(ws, 'exec_output', { execId, data: payload.toString('base64') });
    await new Promise((r) => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].toString()).toBe('from container');
  });

  test('exec_ready for pre-registered execId preserves outputHandler', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const received: Buffer[] = [];
    const execId = await adapter.startExec('c1', ['/bin/bash'], {
      outputCallback: (buf) => received.push(buf),
    });

    // Agent sends exec_ready (should not overwrite existing session / clear handler)
    sendFrame(ws, 'exec_ready', { execId });
    await new Promise((r) => setTimeout(r, 0));

    // Output after exec_ready must still reach callback
    const payload = Buffer.from('after ready');
    sendFrame(ws, 'exec_output', { execId, data: payload.toString('base64') });
    await new Promise((r) => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].toString()).toBe('after ready');
  });
});

describe('EdgeAgentAdapter — requestContainerLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends dd:container_log_request frame and resolves on dd:container_log_response', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-abc';
    const logPromise = adapter.requestContainerLogs(containerId, { tail: 100 });

    // Verify the sent frame
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { containerId: string; tail: number };
    };
    expect(sentFrame.type).toBe('dd:container_log_request');
    expect(sentFrame.data.containerId).toBe(containerId);
    expect(sentFrame.data.tail).toBe(100);

    // Agent sends log response
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'line1\nline2\n' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await logPromise;
    expect(result).toBe('line1\nline2\n');
  });

  test('requestContainerLogs rejects after 30s timeout', async () => {
    vi.useFakeTimers();
    const { adapter } = createAdapter();
    adapter.activate();

    const logPromise = adapter.requestContainerLogs('c-timeout');

    vi.advanceTimersByTime(31_000);
    await expect(logPromise).rejects.toThrow(/timed out/);

    vi.useRealTimers();
  });

  test('onDisconnect rejects pending log request', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    const logPromise = adapter.requestContainerLogs('c-disc').catch((err: Error) => err.message);

    await adapter.onDisconnect();

    expect(await logPromise).toMatch(/connection closed/);
  });
});

describe('buildEdgeSentinelConfig', () => {
  test('returns correct sentinel config for a given agentId', () => {
    const config = buildEdgeSentinelConfig('my-agent');
    expect(config.host).toBe('http://edge-agent-placeholder-my-agent');
    expect(config.port).toBe(0);
    expect(config.secret).toBe('');
  });
});

describe('EdgeAgentAdapter — activate error handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('ws error event logs and calls onDisconnect', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    ws.emit('error', new Error('connection reset'));
    await new Promise((r) => setTimeout(r, 10));

    expect(manager.removeAgent).toHaveBeenCalled();
  });

  test('onMessage catch block logs when frame handler throws', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Make handleContainerSync throw — onMessage catches it and logs
    (
      client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }
    ).handleContainerSync.mockRejectedValueOnce(new Error('sync failed'));

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 10));

    // No crash — the error was caught and logged
    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — frame dispatch additional paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('non-JSON frame logs warn and returns', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    ws.emit('message', 'not-valid-json{{{');
    await new Promise((r) => setTimeout(r, 10));

    // No crash — logged and returned
    expect(ws.close).not.toHaveBeenCalled();
  });

  test('malformed frame (type is null) logs warn', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    ws.emit('message', JSON.stringify({ type: null, data: null }));
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('dd:watch_container_response is logged at debug', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() => sendFrame(ws, 'dd:watch_container_response', { watcherId: 'w1' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  test('dd:trigger_response is logged at debug', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() => sendFrame(ws, 'dd:trigger_response', { triggerId: 't1' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  test('error frame with no requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'error', { message: 'some error' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('error frame with unknown requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'error', { requestId: 'nonexistent-req-id', message: 'fail' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('error frame with known requestId rejects the pending promise', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Issue a request to register a pending entry
    const requestPromise = adapter.sendRequest('GET', '/containers');

    // Extract the requestId from the sent WS frame
    const sentRaw = (ws.send as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]?.[0] as string;
    const sentFrame = JSON.parse(sentRaw) as { data: { requestId: string } };
    const requestId = sentFrame.data.requestId;

    // Send an error frame with the matching requestId
    sendFrame(ws, 'error', { requestId, message: 'agent rejected request' });

    // The promise should reject with the error message
    await expect(requestPromise).rejects.toThrow('agent rejected request');
  });

  test('unknown frame type is logged at debug', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() => sendFrame(ws, 'completely_unknown_frame_type', { foo: 'bar' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  test('handleContainerLogResponse with no containerId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_log_response', { logs: 'some logs' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('response frame with no requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'response', { statusCode: 200, body: 'ok' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('response frame with unknown requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'response', { requestId: 'no-such-id', statusCode: 200 });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('stream frame with no requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'stream', { data: 'chunk' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('stream_end frame with no requestId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'stream_end', { reason: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_ready with no execId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_ready', {});
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_output with no execId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_output', { data: 'aGVsbG8=' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_output with unknown execId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_output', { execId: 'no-such-session', data: 'aGVsbG8=' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_end with no execId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'exec_end', {});
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — emitAgentConnected catch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('logs debug when emitAgentConnected rejects', async () => {
    vi.mocked(emitAgentConnected).mockRejectedValueOnce(new Error('event bus down'));

    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 10));

    // No crash — the rejection was caught and logged at debug
    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — requestContainerLogs limit and send error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('rejects immediately when pending request limit is reached', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };

    // Fill to limit
    for (let i = 0; i < 100; i++) {
      adapterInternal.pendingRequests.set(`req-${i}`, {
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, 99_999),
      });
    }

    await expect(adapter.requestContainerLogs('c-overflow')).rejects.toThrow(
      /concurrent request limit/,
    );

    // Clean up timers
    for (const [, pending] of adapterInternal.pendingRequests) {
      clearTimeout((pending as { timer: ReturnType<typeof setTimeout> }).timer);
    }
  });

  test('rejects when ws.send throws during requestContainerLogs', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Make send throw on next call
    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    await expect(adapter.requestContainerLogs('c-throw')).rejects.toThrow('send failed');
  });
});

describe('EdgeAgentAdapter — sendStreamRequest limit and send error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('rejects immediately when pending request limit is reached', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };

    for (let i = 0; i < 100; i++) {
      adapterInternal.pendingRequests.set(`req-${i}`, {
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, 99_999),
      });
    }

    await expect(adapter.sendStreamRequest('GET', '/containers/c1/logs')).rejects.toThrow(
      /concurrent request limit/,
    );

    for (const [, pending] of adapterInternal.pendingRequests) {
      clearTimeout((pending as { timer: ReturnType<typeof setTimeout> }).timer);
    }
  });

  test('rejects when ws.send throws during sendStreamRequest', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('stream send failed');
    });

    await expect(adapter.sendStreamRequest('GET', '/containers/c1/logs')).rejects.toThrow(
      'stream send failed',
    );
  });
});

describe('EdgeAgentAdapter — sendRequest limit and send error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends error frame and rejects when pending request limit is reached', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };

    for (let i = 0; i < 100; i++) {
      adapterInternal.pendingRequests.set(`req-${i}`, {
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, 99_999),
      });
    }

    await expect(adapter.sendRequest('GET', '/containers')).rejects.toThrow(
      /concurrent request limit/,
    );

    // Verify an error frame was sent to the agent
    const lastSent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { code: string };
    };
    expect(lastSent.type).toBe('error');
    expect(lastSent.data.code).toBe('stream-limit');

    for (const [, pending] of adapterInternal.pendingRequests) {
      clearTimeout((pending as { timer: ReturnType<typeof setTimeout> }).timer);
    }
  });

  test('sendRequest with limit reached — send still works when ws.send throws on error frame', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };

    for (let i = 0; i < 100; i++) {
      adapterInternal.pendingRequests.set(`req-${i}`, {
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, 99_999),
      });
    }

    // Make the error-frame send throw to hit the inner catch
    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('send threw during limit error');
    });

    await expect(adapter.sendRequest('GET', '/containers')).rejects.toThrow(
      /concurrent request limit/,
    );

    for (const [, pending] of adapterInternal.pendingRequests) {
      clearTimeout((pending as { timer: ReturnType<typeof setTimeout> }).timer);
    }
  });

  test('rejects and cleans up when ws.send throws after registering pending', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Make send throw on next call (the actual request send, not the error-frame send)
    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('request send failed');
    });

    await expect(adapter.sendRequest('GET', '/containers')).rejects.toThrow('request send failed');
  });
});

describe('EdgeAgentAdapter — startExec close closure and send error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exec_end after startExec invokes the startExec close closure', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const execId = await adapter.startExec('c1', ['/bin/bash']);

    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, unknown>;
    };
    expect(adapterInternal.execSessions.has(execId)).toBe(true);

    // Send exec_end with the execId returned by startExec
    // This hits the startExec close closure (line 589)
    sendFrame(ws, 'exec_end', { execId });
    await new Promise((r) => setTimeout(r, 0));

    expect(adapterInternal.execSessions.has(execId)).toBe(false);
  });

  test('startExec rejects when ws.send throws', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('exec start send failed');
    });

    await expect(adapter.startExec('c1', ['/bin/bash'])).rejects.toThrow('exec start send failed');
  });
});

describe('EdgeAgentAdapter — emitAgentDisconnected catch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('logs debug when emitAgentDisconnected rejects', async () => {
    vi.mocked(emitAgentDisconnected).mockRejectedValueOnce(new Error('event bus down'));

    const { adapter, ws: _ws, client } = createAdapter();
    adapter.activate();

    // Mark as connected
    (adapter as unknown as { connected: boolean }).connected = true;
    client.isConnected = true;

    await adapter.onDisconnect();

    // No crash — rejection logged at debug
    expect(manager.removeAgent).toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — stream sessionId branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stream frame with sessionId (not requestId) is routed correctly', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    // Get the requestId from the sent frame
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Send stream with sessionId instead of requestId — covers the sessionId branch in handleStream
    sendFrame(ws, 'stream', { sessionId: requestId, data: 'chunk' });
    await new Promise((r) => setTimeout(r, 0));

    // Then resolve with stream_end using sessionId
    sendFrame(ws, 'stream_end', { sessionId: requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    expect((result as { complete: boolean }).complete).toBe(true);
  });

  test('stream frame with requestId not in pending map is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send stream with a requestId that was never registered via sendStreamRequest
    sendFrame(ws, 'stream', { requestId: 'unknown-stream-id', data: 'chunk' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('stream_end with sessionId (not requestId) resolves promise', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Resolve with stream_end using sessionId — covers the sessionId branch in handleStreamEnd
    sendFrame(ws, 'stream_end', { sessionId: requestId, reason: 'end-via-session' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    expect((result as { complete: boolean; reason: string }).reason).toBe('end-via-session');
  });

  test('stream_end with requestId not in pending map is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send stream_end with an unknown requestId — covers the false branch at `if (pending)` in handleStreamEnd
    sendFrame(ws, 'stream_end', { requestId: 'no-such-stream-id', reason: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — branch coverage for uncovered paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exec_output with non-string data field is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Create a session with execId
    sendFrame(ws, 'exec_ready', { execId: 'exec-branch-1' });
    await new Promise((r) => setTimeout(r, 0));

    // Send exec_output with execId but data is a number (not string) — covers false branch of rawData ternary
    ws.emit(
      'message',
      JSON.stringify({ type: 'exec_output', data: { execId: 'exec-branch-1', data: 42 } }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('exec_end with execId not in sessions map is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send exec_end with an execId that was never registered — covers false branch of `if (session)`
    sendFrame(ws, 'exec_end', { execId: 'nonexistent-exec-id-xyz' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('onDisconnect when pingInterval is already undefined (called twice)', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    // First call — clears pingInterval (sets to undefined)
    await adapter.onDisconnect();
    // Second call — pingInterval is already undefined, covers the false branch
    await adapter.onDisconnect();

    expect(manager.removeAgent).toHaveBeenCalledTimes(2);
  });

  test('exec_output to session without outputHandler is a no-op (no crash)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Register session without outputHandler via exec_ready
    sendFrame(ws, 'exec_ready', { execId: 'exec-no-handler' });
    await new Promise((r) => setTimeout(r, 0));

    // exec_output with valid execId and data — session exists but no outputHandler
    const data = Buffer.from('test data').toString('base64');
    sendFrame(ws, 'exec_output', { execId: 'exec-no-handler', data });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('containerSyncWarnTimer — connected=true suppresses the warning', () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Mark as connected before the timer fires so the warn branch is not taken
    (adapter as unknown as { connected: boolean }).connected = true;

    // Advance to fire the 30s container sync warn timer
    vi.advanceTimersByTime(31_000);

    // No close called — the timer ran but skipped the warn because connected=true
    expect(ws.close).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('error frame with non-string message uses fallback "agent error"', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Issue a request to register a pending entry
    const requestPromise = adapter.sendRequest('GET', '/containers');

    const sentRaw = (ws.send as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]?.[0] as string;
    const sentFrame = JSON.parse(sentRaw) as { data: { requestId: string } };
    const requestId = sentFrame.data.requestId;

    // Send an error frame with message as a number (not a string) → hits the false branch of
    // typeof data.message === 'string' ? data.message : 'agent error'
    sendFrame(ws, 'error', { requestId, message: 42 });

    await expect(requestPromise).rejects.toThrow('agent error');
  });

  test('stream frame using sessionId (not requestId) as key', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Register a pending stream under a sessionId key
    const sessionId = 'session-abc-123';
    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };
    adapterInternal.pendingRequests.set(`stream:${sessionId}`, {
      resolve: () => {},
      reject: () => {},
      timer: setTimeout(() => {}, 99_999),
    });

    // Send stream frame with sessionId (no requestId) — exercises the sessionId ternary branch
    sendFrame(ws, 'stream', { sessionId, data: 'chunk' });
    await new Promise((r) => setTimeout(r, 10));

    // No crash — sessionId was used as the lookup key
    expect(ws.close).not.toHaveBeenCalled();

    clearTimeout(
      (
        adapterInternal.pendingRequests.get(`stream:${sessionId}`) as {
          timer: ReturnType<typeof setTimeout>;
        }
      )?.timer,
    );
  });

  test('stream frame with known requestId where no pending exists (if(pending) false)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send stream with a requestId that has no matching pending entry
    sendFrame(ws, 'stream', { requestId: 'no-pending-req', data: 'chunk' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('stream_end frame using sessionId (not requestId) as key', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Register a pending stream under a sessionId key
    const sessionId = 'session-end-xyz';
    const adapterInternal = adapter as unknown as {
      pendingRequests: Map<string, unknown>;
    };
    let resolved = false;
    adapterInternal.pendingRequests.set(`stream:${sessionId}`, {
      resolve: () => {
        resolved = true;
      },
      reject: () => {},
      timer: setTimeout(() => {}, 99_999),
    });

    // Send stream_end with sessionId (no requestId) — exercises the sessionId ternary branch
    sendFrame(ws, 'stream_end', { sessionId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    expect(resolved).toBe(true);
    expect(ws.close).not.toHaveBeenCalled();
  });

  test('stream_end with known requestId where no pending exists (if(pending) false)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send stream_end with a requestId that has no matching pending entry
    sendFrame(ws, 'stream_end', { requestId: 'no-pending-stream', reason: 'done' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — false-branch coverage for ternary fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('dd:container_sync with non-array containers falls back to empty array', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Send containers as a non-array (string) — exercises the `[] ` false branch of Array.isArray
    sendFrame(ws, 'dd:container_sync', { containers: 'not-an-array' });
    await new Promise((r) => setTimeout(r, 10));

    expect(
      (client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync,
    ).toHaveBeenCalledWith([]);
  });

  test('dd:component_sync with non-array watchers and triggers falls back to empty arrays', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Send watchers and triggers as non-arrays — exercises both `[]` false branches
    sendFrame(ws, 'dd:component_sync', { watchers: 'bad', triggers: 'bad' });
    await new Promise((r) => setTimeout(r, 10));

    expect(
      (client as unknown as { handleComponentSync: ReturnType<typeof vi.fn> }).handleComponentSync,
    ).toHaveBeenCalledWith([], []);
  });

  test('metrics frame with zero memoryTotal and zero uptime uses fallback values', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Pre-set some values so the fallback can be verified
    (client as unknown as { info: Record<string, unknown> }).info = {
      memoryGb: 4,
      uptimeSeconds: 1000,
    };

    // memoryTotal=0 → fallback to existing client.info.memoryGb
    // uptime=0 → fallback to existing client.info.uptimeSeconds
    sendFrame(ws, 'metrics', { memoryTotal: 0, uptime: 0 });
    await new Promise((r) => setTimeout(r, 10));

    // The false branch of each ternary was taken — info preserved
    expect(client.info.memoryGb).toBe(4);
    expect(client.info.uptimeSeconds).toBe(1000);
  });

  test('metrics frame with non-number memoryTotal and uptime falls back to 0', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Pre-set info so we can verify fallback is NOT using pre-existing values
    (client as unknown as { info: Record<string, unknown> }).info = {
      memoryGb: undefined,
      uptimeSeconds: undefined,
    };

    // Send metrics with non-number values — covers the `typeof ... === 'number' ? ... : 0` false branch at lines 265-266
    sendFrame(ws, 'metrics', { memoryTotal: 'not-a-number', uptime: null });
    await new Promise((r) => setTimeout(r, 10));

    // Both fall back to 0, so memoryTotal > 0 is false → memoryGb stays undefined, uptime 0 > 0 is false → uptimeSeconds stays undefined
    expect(client.info.memoryGb).toBeUndefined();
    expect(client.info.uptimeSeconds).toBeUndefined();
  });

  test('dd:container_log_response with unknown containerId is a no-op (if(pending) false)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Send a log response for a containerId that has no matching pending request
    sendFrame(ws, 'dd:container_log_response', { containerId: 'unknown-container', logs: 'hello' });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});
