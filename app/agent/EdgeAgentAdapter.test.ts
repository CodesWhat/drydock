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
// Stateful mock: mirrors the real manager.ts single-registry-slot-per-name
// semantics closely enough for onDisconnect()'s instance-checked removal
// (Bug 3, leg 3) to be exercised realistically. `current` tracks whichever
// client was most recently addAgent()-ed; getAgent() only returns it while its
// name matches, so a test that constructs a second adapter for the same name
// (simulating a reconnect) makes the first adapter's own instance check fail,
// exactly like the real registry would once the reconnected client displaces it.
vi.mock('./manager.js', () => {
  let current: { name: string } | undefined;
  return {
    addAgent: vi.fn((client: { name: string }) => {
      current = client;
    }),
    removeAgent: vi.fn((name: string) => {
      if (current?.name === name) {
        current = undefined;
        return true;
      }
      return false;
    }),
    getAgent: vi.fn((name: string) => (current?.name === name ? current : undefined)),
    getAgents: vi.fn(() => (current ? [current] : [])),
  };
});

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
    // Real (not a no-op stub): removes the listener from `listeners` so tests
    // can verify Bug 3 leg 2 — that checkLivenessAndPing() detaches 'close'/
    // 'error' before forcing a close, so a subsequently-emitted real 'close'
    // event does not re-invoke onDisconnect().
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const existing = listeners.get(event);
      if (!existing) {
        return;
      }
      const index = existing.indexOf(listener);
      if (index !== -1) {
        existing.splice(index, 1);
      }
    }),
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

function createAdapter(hello?: Partial<HelloMessage>, options: { reconnected?: boolean } = {}) {
  const ws = createMockWs();
  const helloMsg = createHello(hello);
  const client = new AgentClient(`portwing-edge-${helloMsg.agentId}`, {
    host: 'http://edge-agent-placeholder',
    port: 0,
    secret: '',
  });
  const adapter = new EdgeAgentAdapter(client, ws, options);
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
      memoryTotal: 8 * 1024 ** 3,
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
    // When the session limit is reached, startExec rejects before registering any session,
    // so no exec_end should be sent for the rejected call. exec_end is only sent by the
    // close() closure of successfully-registered sessions (O5 fix).
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

    // No new frame should have been sent — the session was never registered so
    // no exec_end is generated (exec_end is only sent from the close() closure of a
    // successfully-registered session, which this rejected call never created).
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

  test('onDisconnect clears all exec sessions and sends exec_end for each (O5)', async () => {
    // O5 fix: onDisconnect calls session.close() for each live session, which now
    // sends exec_end to the edge before deleting the map entry.
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Register a session via startExec so the close closure includes sendExecEnd
    const execId = await adapter.startExec('c1', ['/bin/bash']);
    ws.sentMessages.length = 0; // clear exec_start frame

    const adapterInternal = adapter as unknown as { execSessions: Map<string, unknown> };
    expect(adapterInternal.execSessions.size).toBe(1);

    await adapter.onDisconnect();

    expect(adapterInternal.execSessions.size).toBe(0);

    // exec_end must have been sent to the edge for the live session (O5)
    expect(
      ws.sentMessages.some((m) => {
        const parsed = JSON.parse(m) as { type: string; data: { execId: string } };
        return parsed.type === 'exec_end' && parsed.data.execId === execId;
      }),
    ).toBe(true);
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

  test('emits agentConnected as a reconnect when the gateway recognizes the identity', async () => {
    const { adapter, ws } = createAdapter(undefined, { reconnected: true });
    adapter.activate();

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(emitAgentConnected).toHaveBeenCalledWith(expect.objectContaining({ reconnected: true }));
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

describe('EdgeAgentAdapter — deleteContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends dd:container_delete_request frame and resolves on success response', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-abc';
    const deletePromise = adapter.deleteContainer(containerId);

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { containerId: string };
    };
    expect(sentFrame.type).toBe('dd:container_delete_request');
    expect(sentFrame.data.containerId).toBe(containerId);

    sendFrame(ws, 'dd:container_delete_response', { containerId, success: true });
    await new Promise((r) => setTimeout(r, 0));

    await expect(deletePromise).resolves.toBeUndefined();
  });

  test('rejects with the agent-provided error message on failure response', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-fail';
    // Attach the rejection handler immediately (same tick) so the rejection
    // triggered synchronously by sendFrame below is never briefly unhandled.
    const deletePromise = adapter.deleteContainer(containerId).catch((err: Error) => err.message);

    sendFrame(ws, 'dd:container_delete_response', {
      containerId,
      success: false,
      error: 'container is running',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(await deletePromise).toBe('container is running');
  });

  test('rejects with a fallback message when failure response omits error', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-fail-no-msg';
    const deletePromise = adapter.deleteContainer(containerId).catch((err: Error) => err.message);

    sendFrame(ws, 'dd:container_delete_response', { containerId, success: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(await deletePromise).toBe('delete failed');
  });

  test('deleteContainer rejects after 30s timeout', async () => {
    vi.useFakeTimers();
    const { adapter } = createAdapter();
    adapter.activate();

    const deletePromise = adapter.deleteContainer('c-timeout');

    vi.advanceTimersByTime(31_000);
    await expect(deletePromise).rejects.toThrow(/timed out/);

    vi.useRealTimers();
  });

  test('onDisconnect rejects pending delete request', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    const deletePromise = adapter.deleteContainer('c-disc').catch((err: Error) => err.message);

    await adapter.onDisconnect();

    expect(await deletePromise).toMatch(/connection closed/);
  });

  test('handleContainerDeleteResponse with no containerId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    expect(() => sendFrame(ws, 'dd:container_delete_response', { success: true })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('dd:container_delete_response with unknown containerId is a no-op', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'dd:container_delete_response', {
      containerId: 'unknown-container',
      success: true,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — deleteContainer limit and send error', () => {
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

    await expect(adapter.deleteContainer('c-overflow')).rejects.toThrow(/concurrent request limit/);

    // Clean up timers
    for (const [, pending] of adapterInternal.pendingRequests) {
      clearTimeout((pending as { timer: ReturnType<typeof setTimeout> }).timer);
    }
  });

  test('rejects when ws.send throws during deleteContainer', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    await expect(adapter.deleteContainer('c-throw')).rejects.toThrow('send failed');
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

  test('exec_end after startExec invokes the startExec close closure and sends exec_end to edge (O5)', async () => {
    // O5 fix: session.close() now sends exec_end to the edge BEFORE deleting the map
    // entry, so the edge can tear down Docker exec processes / goroutines.
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const execId = await adapter.startExec('c1', ['/bin/bash']);
    ws.sentMessages.length = 0; // clear exec_start frame

    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, unknown>;
    };
    expect(adapterInternal.execSessions.has(execId)).toBe(true);

    // Send exec_end with the execId returned by startExec
    // This hits the startExec close closure which now calls sendExecEnd(execId)
    sendFrame(ws, 'exec_end', { execId });
    await new Promise((r) => setTimeout(r, 0));

    expect(adapterInternal.execSessions.has(execId)).toBe(false);

    // Verify exec_end was sent outbound to the edge agent (O5)
    expect(
      ws.sentMessages.some((m) => {
        const parsed = JSON.parse(m) as { type: string; data: { execId: string } };
        return parsed.type === 'exec_end' && parsed.data.execId === execId;
      }),
    ).toBe(true);
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

  test('onDisconnect when called twice is idempotent (Bug 3 regression)', async () => {
    const { adapter } = createAdapter();
    adapter.activate();

    // First call — clears pingInterval, removes the agent from the registry.
    await adapter.onDisconnect();
    // Second call (e.g. a stale forced-close's synchronous onDisconnect()
    // followed by the real transport's delayed 'close' event still firing)
    // must be a no-op: cleanup — including the registry removal — must not
    // run twice for the same adapter instance.
    await adapter.onDisconnect();

    expect(manager.removeAgent).toHaveBeenCalledTimes(1);
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

describe('EdgeAgentAdapter — O4: stream inactivity timeout resets on chunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stream chunks arriving within 30s reset the timer so the promise does not time out', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Advance 25s — no timeout yet (timer is 30s)
    vi.advanceTimersByTime(25_000);

    // A chunk arrives — this resets the 30s inactivity timer
    sendFrame(ws, 'stream', { requestId, data: Buffer.from('chunk').toString('base64') });

    // Advance another 25s — without the reset this would have timed out (25+25=50>30)
    vi.advanceTimersByTime(25_000);

    // Stream ends now — should still resolve (total 50s but timer was reset at 25s)
    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });

    vi.useRealTimers();
    const result = await streamPromise;
    expect((result as { complete: boolean }).complete).toBe(true);
  });

  test('stream times out when no chunk arrives within 30s of the last activity', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/logs?follow=1');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Advance 25s and send a chunk (resets timer)
    vi.advanceTimersByTime(25_000);
    sendFrame(ws, 'stream', { requestId, data: Buffer.from('chunk').toString('base64') });

    // Now advance 31s with NO new chunk — should time out
    vi.advanceTimersByTime(31_000);

    await expect(streamPromise).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });
});

describe('EdgeAgentAdapter — O7: metrics reads all 11 fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('metrics frame populates all 11 camelCase fields on client.info', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'metrics', {
      cpuUsage: 0.75,
      cpuCores: 8,
      memoryTotal: 16 * 1024 ** 3,
      memoryUsed: 8 * 1e9,
      memoryFree: 8 * 1e9,
      diskTotal: 500 * 1e9,
      diskUsed: 200 * 1e9,
      diskFree: 300 * 1e9,
      networkRxBytes: 1_000_000,
      networkTxBytes: 500_000,
      uptime: 7200,
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(client.info.memoryGb).toBeCloseTo(16, 1);
    expect(client.info.uptimeSeconds).toBe(7200);
    expect(client.info.cpuUsage).toBe(0.75);
    expect(client.info.cpuCores).toBe(8);
    expect(client.info.memoryUsed).toBe(8 * 1e9);
    expect(client.info.memoryFree).toBe(8 * 1e9);
    expect(client.info.diskTotal).toBe(500 * 1e9);
    expect(client.info.diskUsed).toBe(200 * 1e9);
    expect(client.info.diskFree).toBe(300 * 1e9);
    expect(client.info.networkRxBytes).toBe(1_000_000);
    expect(client.info.networkTxBytes).toBe(500_000);
  });

  test('metrics frame with missing optional fields leaves them absent from client.info', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    sendFrame(ws, 'metrics', { memoryTotal: 8 * 1e9, uptime: 3600 });
    await new Promise((r) => setTimeout(r, 0));

    expect(client.info.cpuUsage).toBeUndefined();
    expect(client.info.cpuCores).toBeUndefined();
    expect(client.info.memoryUsed).toBeUndefined();
  });
});

describe('EdgeAgentAdapter — O9: response isStream=true stashes headers/statusCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('response frame with isStream=true stashes statusCode/headers and does not resolve', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    let resolved = false;
    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    streamPromise
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    // Portwing sends initial response frame before stream chunks
    sendFrame(ws, 'response', {
      requestId,
      isStream: true,
      statusCode: 200,
      headers: { 'content-type': 'application/x-tar' },
    });
    await new Promise((r) => setTimeout(r, 0));

    // Must NOT have resolved yet (stream chunks still pending)
    expect(resolved).toBe(false);

    // Resolve with stream_end — statusCode/headers must appear in resolved value
    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    const res = result as {
      complete: boolean;
      statusCode?: number;
      headers?: Record<string, string>;
      body: Buffer;
    };
    expect(res.complete).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toBe('application/x-tar');
  });

  test('response with isStream=true that receives no chunks times out and rejects (covers stream-response inactivity timer)', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    sendFrame(ws, 'response', {
      requestId,
      isStream: true,
      statusCode: 200,
      headers: { 'content-type': 'application/x-tar' },
    });
    vi.advanceTimersByTime(31_000);

    await expect(streamPromise).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });

  test('isStream=true response without statusCode/headers leaves them unset (covers false guards)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    sendFrame(ws, 'response', { requestId, isStream: true });
    await new Promise((r) => setTimeout(r, 0));

    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    const res = result as {
      complete: boolean;
      statusCode?: number;
      headers?: Record<string, string>;
    };
    expect(res.complete).toBe(true);
    expect(res.statusCode).toBeUndefined();
    expect(res.headers).toBeUndefined();
  });

  test('stream frame with non-string data is ignored (covers false branch of typeof check)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    sendFrame(ws, 'stream', { requestId });
    await new Promise((r) => setTimeout(r, 0));

    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    const res = result as { complete: boolean; body: Buffer };
    expect(res.complete).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

describe('EdgeAgentAdapter — O10: stream chunks assembled into body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stream chunks are base64-decoded and concatenated; body appears in resolved value', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    const part1 = Buffer.from('hello ');
    const part2 = Buffer.from('world');

    sendFrame(ws, 'stream', { requestId, data: part1.toString('base64') });
    sendFrame(ws, 'stream', { requestId, data: part2.toString('base64') });
    await new Promise((r) => setTimeout(r, 0));

    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    const res = result as { complete: boolean; body: Buffer };
    expect(res.complete).toBe(true);
    expect(res.body.toString()).toBe('hello world');
  });

  test('stream_end with no preceding chunks resolves with empty body', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const streamPromise = adapter.sendStreamRequest('GET', '/containers/c1/archive');
    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const { requestId } = sentFrame.data;

    sendFrame(ws, 'stream_end', { requestId, reason: 'done' });
    await new Promise((r) => setTimeout(r, 0));

    const result = await streamPromise;
    const res = result as { complete: boolean; body: Buffer };
    expect(res.complete).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

describe('EdgeAgentAdapter — O12: startExec includes tty field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('startExec sends tty: true by default', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    await adapter.startExec('c1', ['/bin/bash']);

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { tty: boolean };
    };
    expect(sentFrame.type).toBe('exec_start');
    expect(sentFrame.data.tty).toBe(true);
  });

  test('startExec sends tty: false when explicitly set', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    await adapter.startExec('c1', ['/bin/sh', '-c', 'ls'], { tty: false });

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { tty: boolean };
    };
    expect(sentFrame.type).toBe('exec_start');
    expect(sentFrame.data.tty).toBe(false);
  });
});

describe('EdgeAgentAdapter — O5: startExec close sends exec_end outbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('calling session.close() directly sends exec_end to edge', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const execId = await adapter.startExec('c1', ['/bin/bash']);
    ws.sentMessages.length = 0; // clear exec_start

    // Call close() directly (simulates caller-side teardown)
    const adapterInternal = adapter as unknown as {
      execSessions: Map<string, { close: () => void }>;
    };
    adapterInternal.execSessions.get(execId)?.close();

    const execEndSent = ws.sentMessages.some((m) => {
      const parsed = JSON.parse(m) as { type: string; data: { execId: string } };
      return parsed.type === 'exec_end' && parsed.data.execId === execId;
    });
    expect(execEndSent).toBe(true);
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

describe('EdgeAgentAdapter — ping/pong liveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('closes the connection and frees the agent slot after missing pong for 2 ping cycles (60s)', async () => {
    vi.useFakeTimers();
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Agent never replies with 'pong'. Two 30s ping cycles elapse with no pong.
    vi.advanceTimersByTime(30_000 * 2);

    expect(ws.close).toHaveBeenCalledWith(1001, 'ping timeout');
    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);

    vi.useRealTimers();
  });

  test('does not close the connection when the agent replies with pong every cycle', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Simulate 4 healthy ping/pong cycles (well past the 2-cycle timeout threshold
    // if pongs were not being tracked).
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(30_000);
      sendFrame(ws, 'pong', { timestamp: Date.now() });
    }

    expect(ws.close).not.toHaveBeenCalled();
    expect(manager.removeAgent).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('EdgeAgentAdapter — Bug 3 regressions (double onDisconnect / stale eviction)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('forced close from checkLivenessAndPing detaches close/error listeners so a delayed real close event does not double-fire onDisconnect', async () => {
    vi.useFakeTimers();
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Agent never replies with 'pong'. After 2 missed 30s cycles (60s) the
    // adapter force-closes the connection and runs onDisconnect() itself.
    vi.advanceTimersByTime(30_000 * 2);

    expect(ws.close).toHaveBeenCalledWith(1001, 'ping timeout');
    expect(manager.removeAgent).toHaveBeenCalledTimes(1);
    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);

    // Simulate the underlying transport still emitting a real 'close' event
    // after ws.close() completes, as a genuine WebSocket would. Bug 3 leg 2
    // (detaching the 'close'/'error' listeners before the forced close) means
    // this must be a no-op: onDisconnect() must not run a second time.
    ws.emit('close');
    await Promise.resolve();

    expect(manager.removeAgent).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test('onDisconnect called twice directly is idempotent even without listener detachment', async () => {
    const { adapter, client } = createAdapter();
    adapter.activate();

    await adapter.onDisconnect();
    await adapter.onDisconnect();

    expect(manager.removeAgent).toHaveBeenCalledTimes(1);
    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);
  });

  test('onDisconnect on a never-activated adapter is a no-op that still completes (pingInterval never set)', async () => {
    // Covers the false branch of `if (this.pingInterval !== undefined)`: with
    // the idempotency guard in place, the only way to reach onDisconnect()
    // with pingInterval still undefined is a first-ever call, since a second
    // call now short-circuits before that check.
    const { adapter } = createAdapter();

    await expect(adapter.onDisconnect()).resolves.toBeUndefined();
  });

  test('a stale adapter delayed onDisconnect must not evict a reconnected agent with the same name', async () => {
    // Two independent adapter instances that share the same agentId, and
    // therefore the same (stable, identity-derived) agent name — simulating a
    // stale connection whose cleanup is delayed past a legitimate reconnect.
    const stale = createAdapter();
    stale.adapter.activate();

    const reconnected = createAdapter();
    reconnected.adapter.activate();
    expect(reconnected.client.name).toBe(stale.client.name);

    vi.clearAllMocks(); // isolate the assertions below to what happens next

    // The stale connection's delayed real close event fires. manager.removeAgent()
    // matches purely by name — without the instance check (Bug 3 leg 3) this
    // would evict the reconnected agent's live registry entry.
    await stale.adapter.onDisconnect();

    expect(manager.removeAgent).not.toHaveBeenCalled();

    // The reconnected agent's own disconnect still works normally afterwards.
    await reconnected.adapter.onDisconnect();

    expect(manager.removeAgent).toHaveBeenCalledWith(reconnected.client.name);
  });
});

describe('EdgeAgentAdapter — torn-down adapter inertness regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a frame delivered directly to onMessage after teardown is inert (dispatch guard)', async () => {
    // Bypasses listener detachment entirely (calls the private dispatch method
    // directly) so this exercises the this.disconnected guard itself, not the
    // (separately covered) listener-detachment path — the guard is the
    // defense-in-depth layer for any WebSocketLike that doesn't support `off`.
    const { adapter, client } = createAdapter();
    adapter.activate();
    await adapter.onDisconnect();
    vi.clearAllMocks();

    const adapterInternal = adapter as unknown as {
      onMessage: (raw: unknown) => Promise<void>;
    };
    await adapterInternal.onMessage(
      JSON.stringify({ type: 'dd:container_sync', data: { containers: [] } }),
    );

    expect(
      (client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync,
    ).not.toHaveBeenCalled();
    expect(emitAgentConnected).not.toHaveBeenCalled();
  });

  test('forced close from checkLivenessAndPing detaches the message listener so a frame arriving in the close window is not dispatched', () => {
    vi.useFakeTimers();
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Agent never replies with 'pong'. After 2 missed 30s cycles (60s) the
    // adapter force-closes the connection, detaching message/close/error
    // listeners before running onDisconnect() itself.
    vi.advanceTimersByTime(30_000 * 2);
    expect(ws.close).toHaveBeenCalledWith(1001, 'ping timeout');

    // A frame already in flight when ws.close() was called still arrives on
    // the underlying transport. Before the fix, the message listener was
    // never detached (only close/error were), so this frame would still be
    // parsed/dispatched on an adapter that has already torn itself down.
    sendFrame(ws, 'dd:container_sync', { containers: [] });

    expect(
      (client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync,
    ).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('handleContainerSync resolving after a forced disconnect does not resurrect connected state or re-emit agentConnected', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    // Make the first container_sync's await hang so we can force a disconnect
    // while it's still in flight — mirrors the ping timer firing mid-sync.
    let resolveSync: () => void = () => {};
    const pendingSync = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });
    const handleContainerSyncMock = (
      client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }
    ).handleContainerSync;
    handleContainerSyncMock.mockReturnValueOnce(pendingSync);

    sendFrame(ws, 'dd:container_sync', { containers: [] });
    // handleContainerSync() has been called synchronously and is now awaiting
    // pendingSync — this.connected is still false at this point.
    expect(handleContainerSyncMock).toHaveBeenCalledTimes(1);

    // Force-disconnect the adapter while the sync above is still pending.
    await adapter.onDisconnect();
    expect((client as unknown as { isConnected: boolean }).isConnected).toBe(false);

    // Now let the original container_sync's await resolve.
    resolveSync();
    await new Promise((r) => setTimeout(r, 0));

    expect(emitAgentConnected).not.toHaveBeenCalled();
    expect((client as unknown as { isConnected: boolean }).isConnected).toBe(false);
    expect((adapter as unknown as { connected: boolean }).connected).toBe(false);
  });
});

describe('EdgeAgentAdapter — Bug 4 regressions (concurrent per-container requests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('two concurrent requestContainerLogs calls for the same container both resolve', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-concurrent-logs';
    const first = adapter.requestContainerLogs(containerId, { tail: 10 });
    const second = adapter.requestContainerLogs(containerId, { tail: 20 });

    // Each call gets its own unique requestId/pendingRequests entry — the old
    // bug overwrote the first entry with the second under the shared
    // `log:${containerId}` key.
    const sentFrames = ws.sentMessages.map(
      (m) => JSON.parse(m) as { data: { containerId: string; requestId: string } },
    );
    expect(sentFrames).toHaveLength(2);
    expect(sentFrames[0].data.requestId).toBeTruthy();
    expect(sentFrames[0].data.requestId).not.toBe(sentFrames[1].data.requestId);

    // These response frames deliberately omit requestId to exercise the legacy
    // no-echo fallback (dequeueOldestContainerRequest), where responses are
    // correlated in FIFO order. A current portwing agent echoes requestId for
    // exact correlation (covered in the 'requestId echo correlation' block); the
    // fix under test here is that BOTH resolve, not that either is silently
    // dropped as a spurious timeout.
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'first-response' });
    await new Promise((r) => setTimeout(r, 0));
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'second-response' });
    await new Promise((r) => setTimeout(r, 0));

    await expect(first).resolves.toBe('first-response');
    await expect(second).resolves.toBe('second-response');
  });

  test('a timed-out requestContainerLogs does not drop a concurrent second request for the same container', async () => {
    vi.useFakeTimers();
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-timeout-mix';
    const first = adapter.requestContainerLogs(containerId).catch((err: Error) => err.message);

    // Second request starts 1s later — both in flight for the same container.
    vi.advanceTimersByTime(1_000);
    const second = adapter.requestContainerLogs(containerId);

    // Advance to exactly the first request's 30s deadline (t=30_000). Its
    // timer fires and rejects it. Under the old bug this delete()'d the
    // shared `log:${containerId}` key out from under the second request too.
    vi.advanceTimersByTime(29_000);
    expect(await first).toMatch(/timed out/);

    // The second request must still be alive and resolve on its own response.
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'still-alive' });

    await expect(second).resolves.toBe('still-alive');

    vi.useRealTimers();
  });

  test('two concurrent deleteContainer calls for the same container both resolve/reject independently', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-concurrent-delete';
    const first = adapter.deleteContainer(containerId).catch((err: Error) => err.message);
    const second = adapter.deleteContainer(containerId);

    const sentFrames = ws.sentMessages.map((m) => JSON.parse(m) as { data: { requestId: string } });
    expect(sentFrames[0].data.requestId).not.toBe(sentFrames[1].data.requestId);

    sendFrame(ws, 'dd:container_delete_response', {
      containerId,
      success: false,
      error: 'first failed',
    });
    await new Promise((r) => setTimeout(r, 0));
    sendFrame(ws, 'dd:container_delete_response', { containerId, success: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(await first).toBe('first failed');
    await expect(second).resolves.toBeUndefined();
  });

  test('removeContainerRequestFromQueue no-ops when no queue exists for the key (defensive branch)', () => {
    const { adapter } = createAdapter();
    const adapterInternal = adapter as unknown as {
      removeContainerRequestFromQueue: (queueKey: string, pendingKey: string) => void;
    };

    expect(() =>
      adapterInternal.removeContainerRequestFromQueue('log:no-such-queue', 'log:no-such-queue:x'),
    ).not.toThrow();
  });

  test('removeContainerRequestFromQueue no-ops when the queue exists but does not contain the key (defensive branch)', () => {
    const { adapter } = createAdapter();
    const adapterInternal = adapter as unknown as {
      containerRequestQueues: Map<string, string[]>;
      removeContainerRequestFromQueue: (queueKey: string, pendingKey: string) => void;
    };
    adapterInternal.containerRequestQueues.set('log:partial', ['log:partial:kept']);

    adapterInternal.removeContainerRequestFromQueue('log:partial', 'log:partial:not-present');

    // The unrelated entry must be untouched.
    expect(adapterInternal.containerRequestQueues.get('log:partial')).toEqual(['log:partial:kept']);
  });

  test('handleContainerLogResponse is a no-op if the queue references a pendingRequests key that is gone (defensive branch)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    // Force the desync case the dequeue-then-lookup pattern defends against:
    // a queue entry exists, but nothing in pendingRequests matches its key.
    const adapterInternal = adapter as unknown as {
      containerRequestQueues: Map<string, string[]>;
    };
    adapterInternal.containerRequestQueues.set('log:desync', ['log:desync:ghost-id']);

    expect(() =>
      sendFrame(ws, 'dd:container_log_response', { containerId: 'desync', logs: 'x' }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });

  test('handleContainerDeleteResponse is a no-op if the queue references a pendingRequests key that is gone (defensive branch)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const adapterInternal = adapter as unknown as {
      containerRequestQueues: Map<string, string[]>;
    };
    adapterInternal.containerRequestQueues.set('delete:desync', ['delete:desync:ghost-id']);

    expect(() =>
      sendFrame(ws, 'dd:container_delete_response', { containerId: 'desync', success: true }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('EdgeAgentAdapter — requestId echo correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requestContainerLogs forwards timestamps:true on the wire when passed, and omits the key entirely when not passed', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const onPromise = adapter.requestContainerLogs('container-ts-on', {
      tail: 50,
      timestamps: true,
    });

    const onFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { containerId: string; requestId: string; tail: number; timestamps?: boolean };
    };
    expect(onFrame.type).toBe('dd:container_log_request');
    expect(onFrame.data.timestamps).toBe(true);
    expect(onFrame.data.tail).toBe(50);

    sendFrame(ws, 'dd:container_log_response', {
      containerId: 'container-ts-on',
      requestId: onFrame.data.requestId,
      logs: 'x',
    });
    await new Promise((r) => setTimeout(r, 0));
    await onPromise;

    const offPromise = adapter.requestContainerLogs('container-ts-off', { tail: 50 });

    const offRaw = ws.sentMessages[ws.sentMessages.length - 1];
    const offFrame = JSON.parse(offRaw) as {
      data: { containerId: string; requestId: string; timestamps?: boolean };
    };
    expect(offFrame.data.timestamps).toBeUndefined();
    expect(offRaw).not.toContain('timestamps');

    sendFrame(ws, 'dd:container_log_response', {
      containerId: 'container-ts-off',
      requestId: offFrame.data.requestId,
      logs: 'y',
    });
    await new Promise((r) => setTimeout(r, 0));
    await offPromise;
  });

  test('two concurrent requestContainerLogs calls for the same container: responses arrive in REVERSE completion order, each still resolves with its OWN logs (exact echo, not FIFO)', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-ooo-logs';
    const first = adapter.requestContainerLogs(containerId, { tail: 10 });
    const second = adapter.requestContainerLogs(containerId, { tail: 20 });

    const sentFrames = ws.sentMessages.map((m) => JSON.parse(m) as { data: { requestId: string } });
    const firstRequestId = sentFrames[0].data.requestId;
    const secondRequestId = sentFrames[1].data.requestId;
    expect(firstRequestId).not.toBe(secondRequestId);

    // Respond to SECOND's request first, echoing its id.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: secondRequestId,
      logs: 'second-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    // Then respond to FIRST's request, echoing its id.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: firstRequestId,
      logs: 'first-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    await expect(first).resolves.toBe('first-logs');
    await expect(second).resolves.toBe('second-logs');
  });

  test('two concurrent deleteContainer calls for the same container: responses arrive in REVERSE completion order (one success, one failure), each resolves/rejects according to its OWN echoed requestId', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-ooo-delete';
    const first = adapter.deleteContainer(containerId).catch((err: Error) => err.message);
    const second = adapter.deleteContainer(containerId);

    const sentFrames = ws.sentMessages.map((m) => JSON.parse(m) as { data: { requestId: string } });
    const firstRequestId = sentFrames[0].data.requestId;
    const secondRequestId = sentFrames[1].data.requestId;

    // Respond to SECOND first (success), echoing its id.
    sendFrame(ws, 'dd:container_delete_response', {
      containerId,
      requestId: secondRequestId,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 0));

    // Then respond to FIRST (failure), echoing its id.
    sendFrame(ws, 'dd:container_delete_response', {
      containerId,
      requestId: firstRequestId,
      success: false,
      error: 'first-error',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(await first).toBe('first-error');
    await expect(second).resolves.toBeUndefined();
  });

  test('an echoed requestId that matches no pending entry does not resolve/steal a different pending request for the same container, leaves it pending, and does not close the socket; a subsequent correctly-echoed response still resolves it', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-miss';
    let resolved = false;
    const pending = adapter.requestContainerLogs(containerId, { tail: 5 });
    pending
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const realRequestId = sentFrame.data.requestId;

    // Echoed id that matches nothing pending — must NOT fall back to FIFO.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: 'bogus-unknown-request-id',
      logs: 'stolen-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(resolved).toBe(false);
    expect(ws.close).not.toHaveBeenCalled();
    const adapterInternal = adapter as unknown as { pendingRequests: Map<string, unknown> };
    expect(adapterInternal.pendingRequests.has(`log:${containerId}:${realRequestId}`)).toBe(true);

    // Correct echo still resolves it.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: realRequestId,
      logs: 'real-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    await expect(pending).resolves.toBe('real-logs');
    expect(resolved).toBe(true);
  });

  test('a response carrying a present-but-empty requestId is treated as an echoed miss (not a legacy no-echo frame): it does not FIFO-resolve the oldest pending request, and a correct echo still resolves it', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-empty-id';
    let resolved = false;
    const pending = adapter.requestContainerLogs(containerId, { tail: 5 });
    pending
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const realRequestId = sentFrame.data.requestId;

    // requestId present but empty — must be treated as an exact-match miss, NOT
    // as a legacy no-requestId frame that would FIFO-resolve the oldest request.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: '',
      logs: 'should-not-steal',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(resolved).toBe(false);
    expect(ws.close).not.toHaveBeenCalled();
    const adapterInternal = adapter as unknown as { pendingRequests: Map<string, unknown> };
    expect(adapterInternal.pendingRequests.has(`log:${containerId}:${realRequestId}`)).toBe(true);

    // The correctly-echoed response still resolves it.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: realRequestId,
      logs: 'real-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    await expect(pending).resolves.toBe('real-logs');
    expect(resolved).toBe(true);
  });

  test('a response carrying a present-but-non-string requestId (malformed frame) is treated as an exact-match miss, not a legacy FIFO frame: it does not steal the oldest pending request', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-nonstring-id';
    let resolved = false;
    const pending = adapter.requestContainerLogs(containerId, { tail: 5 });
    pending
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    const sentFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { requestId: string };
    };
    const realRequestId = sentFrame.data.requestId;

    // requestId present but a number, not a string — must NOT FIFO-resolve the
    // oldest request (only a truly absent field takes the legacy fallback).
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: 12345,
      logs: 'should-not-steal',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(resolved).toBe(false);
    expect(ws.close).not.toHaveBeenCalled();
    const adapterInternal = adapter as unknown as { pendingRequests: Map<string, unknown> };
    expect(adapterInternal.pendingRequests.has(`log:${containerId}:${realRequestId}`)).toBe(true);

    // The correctly-echoed response still resolves it.
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: realRequestId,
      logs: 'real-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    await expect(pending).resolves.toBe('real-logs');
    expect(resolved).toBe(true);
  });

  test('three concurrent requestContainerLogs calls for the same container: an exact-echo response for the MIDDLE request removes it from the FIFO queue without disturbing order, and two subsequent legacy (no-requestId) responses still resolve the two remaining requests oldest-first', async () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    const containerId = 'container-mixed-fifo';
    const first = adapter.requestContainerLogs(containerId, { tail: 1 });
    const second = adapter.requestContainerLogs(containerId, { tail: 2 });
    const third = adapter.requestContainerLogs(containerId, { tail: 3 });

    const sentFrames = ws.sentMessages.map((m) => JSON.parse(m) as { data: { requestId: string } });
    const secondRequestId = sentFrames[1].data.requestId;

    // Resolve the MIDDLE request first via exact echo (removes it from the
    // middle of the FIFO queue via removeContainerRequestFromQueue).
    sendFrame(ws, 'dd:container_log_response', {
      containerId,
      requestId: secondRequestId,
      logs: 'second-logs',
    });
    await new Promise((r) => setTimeout(r, 0));

    await expect(second).resolves.toBe('second-logs');

    // Legacy response with NO requestId — must fall back to oldest-outstanding,
    // which after the removal above is `first`.
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'first-logs' });
    await new Promise((r) => setTimeout(r, 0));

    // A second legacy response with NO requestId — the only one left is `third`.
    sendFrame(ws, 'dd:container_log_response', { containerId, logs: 'third-logs' });
    await new Promise((r) => setTimeout(r, 0));

    await expect(first).resolves.toBe('first-logs');
    await expect(third).resolves.toBe('third-logs');
  });
});

describe('EdgeAgentAdapter — terminate (Fix 2: revoke-path zombie frame)', () => {
  // Regression coverage for: disconnectByKeyId (portwing-ws.ts) revoked a key
  // by sending an error frame and calling ws.close() directly, but never tore
  // down the corresponding adapter synchronously — its message listener
  // stayed attached and `disconnected` stayed false until the real
  // 'close'/'error' event eventually fired. A frame already buffered in the
  // transport when the key was revoked could still reach onMessage() and
  // mutate client/container/metrics state under a key that was, by the time
  // the frame was dispatched, no longer valid. terminate() reuses the same
  // synchronous teardown checkLivenessAndPing() already uses for ping
  // timeouts (detach listeners -> ws.close() -> onDisconnect()) to close that
  // window for revocation too.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends an error frame with the given code/message and closes with the given close code', () => {
    const { adapter, ws } = createAdapter();
    adapter.activate();

    adapter.terminate('unknown-key', 'key revoked', 1008);

    const errorFrame = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      type: string;
      data: { code: string; message: string };
    };
    expect(errorFrame.type).toBe('error');
    expect(errorFrame.data.code).toBe('unknown-key');
    expect(errorFrame.data.message).toBe('key revoked');
    expect(ws.close).toHaveBeenCalledWith(1008, 'unknown-key');
  });

  test('runs onDisconnect synchronously, freeing the agent slot immediately', () => {
    const { adapter, client } = createAdapter();
    adapter.activate();

    adapter.terminate('unknown-key', 'key revoked', 1008);

    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);
  });

  test('detaches the message listener so a frame buffered in the close window is inert (revoke inertness)', () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    adapter.terminate('unknown-key', 'key revoked', 1008);

    // Simulate a frame that was already in flight on the wire when the key
    // was revoked — must be inert: the message listener was detached and
    // this.disconnected flipped true by the synchronous teardown above.
    sendFrame(ws, 'dd:container_sync', { containers: [] });

    expect(
      (client as unknown as { handleContainerSync: ReturnType<typeof vi.fn> }).handleContainerSync,
    ).not.toHaveBeenCalled();
  });

  test('a delayed real close event after terminate does not double-fire onDisconnect', async () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();

    adapter.terminate('unknown-key', 'key revoked', 1008);
    expect(manager.removeAgent).toHaveBeenCalledTimes(1);

    // The underlying transport still emits its real 'close' event after
    // ws.close() completes, as a genuine WebSocket would. Listener detachment
    // (shared with the ping-timeout teardown) means this is a no-op.
    ws.emit('close');
    await Promise.resolve();

    expect(manager.removeAgent).toHaveBeenCalledTimes(1);
    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);
  });

  test('a ws.send failure while sending the error frame does not prevent teardown', () => {
    const { adapter, ws, client } = createAdapter();
    adapter.activate();
    (ws.send as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('socket already closing');
    });

    expect(() => adapter.terminate('unknown-key', 'key revoked', 1008)).not.toThrow();
    expect(ws.close).toHaveBeenCalledWith(1008, 'unknown-key');
    expect(manager.removeAgent).toHaveBeenCalledWith(client.name);
  });
});
