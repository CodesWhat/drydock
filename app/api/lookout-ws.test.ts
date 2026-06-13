/**
 * Tests for the lookout/1.0 WebSocket gateway (lookout-ws.ts).
 * Real Ed25519 keypairs generated in-test via Node crypto.
 */
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentKeyRecord } from '../store/agent-keys.js';
import {
  clearNonceCacheForTesting,
  createLookoutWsGateway,
  LOOKOUT_WS_ROUTE_PATTERN,
} from './lookout-ws.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../agent/AgentClient.js', () => ({
  AgentClient: vi.fn().mockImplementation((name: string) => ({
    name,
    config: {},
    isConnected: false,
    info: {},
    handleEvent: vi.fn().mockResolvedValue(undefined),
    handleContainerSync: vi.fn().mockResolvedValue(undefined),
    handleComponentSync: vi.fn().mockResolvedValue(undefined),
    scheduleStatsChangedPublic: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock('../agent/EdgeAgentAdapter.js', () => ({
  EdgeAgentAdapter: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../agent/manager.js', () => ({
  addAgent: vi.fn(),
  removeAgent: vi.fn(),
  getAgent: vi.fn(() => undefined),
  getAgents: vi.fn(() => []),
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

// ---- Test utilities ----

function generateKeyPair(): { privateKey: import('node:crypto').KeyObject; rawPublicKey: Buffer; pubkeyBase64: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const rawPublicKey = spki.subarray(12); // Ed25519 SPKI = 12-byte header + 32 raw bytes
  const pubkeyBase64 = rawPublicKey.toString('base64');
  const keyId = createHash('sha256').update(rawPublicKey).digest().subarray(0, 8).toString('hex');
  return { privateKey, rawPublicKey, pubkeyBase64, keyId };
}

function signHello(
  privateKey: import('node:crypto').KeyObject,
  timestamp: number,
  nonce: string,
): string {
  const canonical = Buffer.from(
    ['GET', '/api/lookout/ws', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', String(timestamp), nonce].join('\n'),
  );
  const sigBuf = cryptoSign(null, canonical, privateKey);
  return sigBuf.toString('base64url');
}

function makeNonce(): string {
  return 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'; // 32 hex chars
}

type MockWs = {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  listeners: Map<string, ((...args: unknown[]) => void)[]>;
  sentMessages: string[];
  emit: (event: string, ...args: unknown[]) => void;
};

function createMockWs(): MockWs {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const sentMessages: string[] = [];

  const ws: MockWs = {
    send: vi.fn((data: string) => sentMessages.push(data)),
    close: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    }),
    listeners,
    sentMessages,
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
  return ws;
}

type MockSocket = {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  destroyed: boolean;
};

function createMockSocket(): MockSocket {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
    destroyed: false,
  };
}

function createRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function createGateway(
  keyRecord: AgentKeyRecord | null = null,
  options: {
    isRateLimited?: () => boolean;
    getAgent?: () => unknown;
  } = {},
) {
  const mockKeyStore = {
    getKey: vi.fn(() => keyRecord),
    addKey: vi.fn(),
    revokeKey: vi.fn(),
    listKeys: vi.fn(() => []),
    createCollections: vi.fn(),
    loadAuthorizedKeysFile: vi.fn(),
  };

  let upgradedWs: MockWs | undefined;
  const mockWsServer = {
    handleUpgrade: vi.fn(
      (
        _request: unknown,
        _socket: unknown,
        _head: unknown,
        callback: (ws: MockWs) => void,
      ) => {
        upgradedWs = createMockWs();
        callback(upgradedWs);
      },
    ),
  };

  const gateway = createLookoutWsGateway({
    webSocketServer: mockWsServer as unknown as Parameters<typeof createLookoutWsGateway>[0]['webSocketServer'],
    isRateLimited: options.isRateLimited ?? (() => false),
    serverConfiguration: {},
    getAgentKeys: mockKeyStore,
  });

  return { gateway, mockWsServer, mockKeyStore, getUpgradedWs: () => upgradedWs };
}

function sendMessageToGateway(ws: MockWs, payload: unknown) {
  ws.emit('message', JSON.stringify(payload));
}

function buildHello(
  keyId: string,
  timestamp: number,
  nonce: string,
  signature: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'hello',
    data: {
      version: '0.2.0',
      protocol: 'lookout/1.0',
      agentId: 'test-agent-123',
      agentName: 'test-agent',
      dockerVersion: '27.0.0',
      hostname: 'test-host',
      capabilities: ['compose', 'exec', 'metrics', 'events'],
      drydockCompat: '1.4.0',
      pubKeyId: keyId,
      timestamp,
      nonce,
      signature,
      ...overrides,
    },
  };
}

// ---- Tests ----

describe('LOOKOUT_WS_ROUTE_PATTERN', () => {
  test('matches /api/lookout/ws', () => {
    expect(LOOKOUT_WS_ROUTE_PATTERN.test('/api/lookout/ws')).toBe(true);
  });

  test('matches /api/v1/lookout/ws', () => {
    expect(LOOKOUT_WS_ROUTE_PATTERN.test('/api/v1/lookout/ws')).toBe(true);
  });

  test('does not match /api/lookout/ws/extra', () => {
    expect(LOOKOUT_WS_ROUTE_PATTERN.test('/api/lookout/ws/extra')).toBe(false);
  });

  test('does not match /api/containers', () => {
    expect(LOOKOUT_WS_ROUTE_PATTERN.test('/api/containers')).toBe(false);
  });
});

describe('handleUpgrade — pre-upgrade checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  test('does nothing when URL does not match pattern', () => {
    const { gateway, mockWsServer } = createGateway();
    const socket = createMockSocket();
    const request = createRequest('/api/containers');

    gateway.handleUpgrade(request, socket as unknown as Socket, Buffer.alloc(0));

    expect(mockWsServer.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  test('returns 403 when Origin header is present and mismatched', () => {
    const { gateway } = createGateway(null, {});
    const socket = createMockSocket();
    const request = createRequest('/api/lookout/ws', {
      origin: 'http://evil.example.com',
      host: 'mydrydock.example.com',
    });

    gateway.handleUpgrade(request, socket as unknown as Socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect(socket.destroy).toHaveBeenCalled();
  });

  test('returns 429 when rate limited', () => {
    const { gateway } = createGateway(null, { isRateLimited: () => true });
    const socket = createMockSocket();
    const request = createRequest('/api/lookout/ws');

    gateway.handleUpgrade(request, socket as unknown as Socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('429'));
  });
});

describe('handleUpgrade — hello timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('closes with 1008 hello timeout when no message arrives within 30s', async () => {
    const { gateway, getUpgradedWs } = createGateway();
    const socket = createMockSocket();
    const request = createRequest('/api/lookout/ws');

    gateway.handleUpgrade(request, socket as unknown as Socket, Buffer.alloc(0));
    const ws = getUpgradedWs()!;

    vi.advanceTimersByTime(30_001);

    expect(ws.close).toHaveBeenCalledWith(1008, 'hello timeout');
  });
});

describe('hello verification — rejection paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  function doHandshake(
    keyRecord: AgentKeyRecord | null,
    payload: unknown,
    opts: { isRateLimited?: () => boolean } = {},
  ) {
    const { gateway, getUpgradedWs } = createGateway(keyRecord, opts);
    const socket = createMockSocket();
    const request = createRequest('/api/lookout/ws');

    gateway.handleUpgrade(request, socket as unknown as Socket, Buffer.alloc(0));
    const ws = getUpgradedWs()!;

    sendMessageToGateway(ws, payload);
    return { ws };
  }

  test('parse-error on invalid JSON', async () => {
    const { gateway, getUpgradedWs } = createGateway();
    const socket = createMockSocket();
    gateway.handleUpgrade(
      createRequest('/api/lookout/ws'),
      socket as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws = getUpgradedWs()!;

    ws.emit('message', 'not json');
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.type).toBe('error');
    expect(errorFrame.data.code).toBe('parse-error');
    expect(ws.close).toHaveBeenCalledWith(1008, 'parse-error');
  });

  test('expected-hello when type is not hello', async () => {
    const { ws } = doHandshake(null, { type: 'ping', data: {} });
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('expected-hello');
    expect(ws.close).toHaveBeenCalledWith(1008, 'expected-hello');
  });

  test('protocol-mismatch when protocol is lookout/1', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(
      record,
      buildHello(keyId, ts, nonce, sig, { protocol: 'lookout/1' }),
    );
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('protocol-mismatch');
    expect(ws.close).toHaveBeenCalledWith(1008, 'protocol-mismatch');
  });

  test('protocol-mismatch when protocol is lookout/2.0', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(
      record,
      buildHello(keyId, ts, nonce, sig, { protocol: 'lookout/2.0' }),
    );
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('protocol-mismatch');
  });

  test('no-auth when no Ed25519 fields and no tokenHash', async () => {
    const { ws } = doHandshake(null, {
      type: 'hello',
      data: {
        version: '0.2.0',
        protocol: 'lookout/1.0',
        agentId: 'test',
        agentName: 'test',
        dockerVersion: 'unknown',
        hostname: 'test',
        capabilities: [],
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('no-auth');
    expect(ws.close).toHaveBeenCalledWith(1008, 'no-auth');
  });

  test('ed25519-required when tokenHash present but no Ed25519 fields', async () => {
    const { ws } = doHandshake(null, {
      type: 'hello',
      data: {
        version: '0.2.0',
        protocol: 'lookout/1.0',
        agentId: 'test',
        agentName: 'test',
        dockerVersion: 'unknown',
        hostname: 'test',
        capabilities: [],
        tokenHash: 'abcdef1234567890',
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    // Edge endpoint requires Ed25519; token-hash-only agents receive a clear error
    // rather than the generic 'no-auth' code so operators know what to fix.
    expect(errorFrame.data.code).toBe('ed25519-required');
    expect(ws.close).toHaveBeenCalledWith(1008, 'ed25519-required');
  });

  test('unknown-key when key not in registry', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const { ws } = doHandshake(null, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('unknown-key');
    expect(ws.close).toHaveBeenCalledWith(1008, 'unknown-key');
  });

  test('timestamp-skew when timestamp too far in past (now - 61s)', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000) - 61;
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('timestamp-skew');
    expect(ws.close).toHaveBeenCalledWith(1008, 'timestamp-skew');
  });

  test('timestamp-skew when timestamp too far in future (now + 61s)', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000) + 61;
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('timestamp-skew');
  });

  test('bad-nonce when nonce is 31 chars (not 32)', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const badNonce = 'a'.repeat(31); // 31 chars
    const sig = signHello(privateKey, ts, badNonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, badNonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('bad-nonce');
    expect(ws.close).toHaveBeenCalledWith(1008, 'bad-nonce');
  });

  test('replay when same nonce used twice', async () => {
    // Both connections use a valid keypair and a correct signature so that the
    // first hello fully succeeds (nonce is seeded into the global cache only
    // after signature verification), then the second with the identical nonce
    // must be rejected with exactly 'replay' — never 'bad-signature'.
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = makeNonce();
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    clearNonceCacheForTesting();

    // First connection: valid hello — should succeed (welcome sent) and seed the nonce.
    const { gateway: gw1, getUpgradedWs: getWs1 } = createGateway(record);
    gw1.handleUpgrade(
      createRequest('/api/lookout/ws'),
      createMockSocket() as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws1 = getWs1()!;
    sendMessageToGateway(ws1, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 10));

    // Verify the first connection received a welcome (proves the nonce was seeded
    // after successful auth, not before — which is the core invariant being tested).
    const firstFrame = JSON.parse(ws1.sentMessages[0]) as { type: string };
    expect(firstFrame.type).toBe('welcome');

    // Second connection: same nonce — must be rejected with exactly 'replay'.
    const { gateway: gw2, getUpgradedWs: getWs2 } = createGateway(record);
    gw2.handleUpgrade(
      createRequest('/api/lookout/ws'),
      createMockSocket() as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws2 = getWs2()!;
    sendMessageToGateway(ws2, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 10));

    const replayFrame = JSON.parse(ws2.sentMessages[0]) as {
      type: string;
      data: { code: string };
    };
    expect(replayFrame.data.code).toBe('replay');
    expect(ws2.close).toHaveBeenCalledWith(1008, 'replay');
  });

  test('bad-signature when Ed25519 signature is wrong', async () => {
    const { privateKey: _k1, pubkeyBase64, keyId } = generateKeyPair();
    const { privateKey: wrongKey } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    // Different nonce for this test to avoid replay collision
    const nonce = 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(wrongKey, ts, nonce); // signed with wrong key

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('bad-signature');
    expect(ws.close).toHaveBeenCalledWith(1008, 'bad-signature');
  });

  test('revoked key → unknown-key', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    // null simulates getKey returning null (revoked key filtered out)
    const { ws } = doHandshake(null, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('unknown-key');
  });

  test('unknown-key error message does not echo the supplied keyId', async () => {
    // Regression guard: the error body must never reflect attacker-controlled input.
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c2b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const { ws } = doHandshake(null, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string; message: string } };
    expect(errorFrame.data.code).toBe('unknown-key');
    expect(errorFrame.data.message).not.toContain(keyId);
  });

  test('parse-error when agentId is a number', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c3b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig, { agentId: 42 }));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('parse-error');
    expect(ws.close).toHaveBeenCalledWith(1008, 'parse-error');
  });

  test('parse-error when agentId exceeds 64 chars', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c4b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const longId = 'a'.repeat(65);
    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig, { agentId: longId }));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('parse-error');
  });

  test('parse-error when agentId contains unsafe characters', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c5b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { ws } = doHandshake(record, buildHello(keyId, ts, nonce, sig, { agentId: 'agent\x00id' }));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('parse-error');
  });

  test('unknown-key when keyId has wrong format (not 16 hex chars)', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c6b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    // Send a keyId that is too long / contains non-hex chars
    const { ws } = doHandshake(record, buildHello('../../../../etc/passwd', ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 0));

    const errorFrame = JSON.parse(ws.sentMessages[0]) as { type: string; data: { code: string } };
    expect(errorFrame.data.code).toBe('unknown-key');
    expect(ws.close).toHaveBeenCalledWith(1008, 'unknown-key');
  });

  test('bad-signature does NOT seed the nonce into the replay cache', async () => {
    // Regression guard for the pre-fix race: if a bad-sig hello were to commit
    // the nonce, an attacker with one valid keyId could exhaust the nonce pool.
    // After the fix, only verified hellos may seed the cache.
    const { privateKey: _k1, pubkeyBase64, keyId } = generateKeyPair();
    const { privateKey: wrongKey } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'c7b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const badSig = signHello(wrongKey, ts, nonce);
    const goodSig = signHello(_k1, ts, nonce); // correct sig for the same nonce

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    clearNonceCacheForTesting();

    // First attempt: bad signature — must NOT seed the nonce.
    const { ws: ws1 } = doHandshake(record, buildHello(keyId, ts, nonce, badSig));
    await new Promise((r) => setTimeout(r, 10));
    const firstErr = JSON.parse(ws1.sentMessages[0]) as { data: { code: string } };
    expect(firstErr.data.code).toBe('bad-signature');

    // Second attempt: same nonce but now with the correct signature.
    // If the nonce had been seeded on the first (bad-sig) attempt this would
    // return 'replay'; with the fix it must proceed to the welcome.
    const { gateway: gw2, getUpgradedWs: getWs2 } = createGateway(record);
    gw2.handleUpgrade(
      createRequest('/api/lookout/ws'),
      createMockSocket() as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws2 = getWs2()!;
    sendMessageToGateway(ws2, buildHello(keyId, ts, nonce, goodSig));
    await new Promise((r) => setTimeout(r, 10));

    const secondFrame = JSON.parse(ws2.sentMessages[0]) as { type: string };
    expect(secondFrame.type).toBe('welcome');
  });
});

describe('hello verification — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  test('sends welcome with correct structure for valid Ed25519 hello', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'd1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { gateway, getUpgradedWs } = createGateway(record);
    const socket = createMockSocket();
    gateway.handleUpgrade(
      createRequest('/api/lookout/ws'),
      socket as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws = getUpgradedWs()!;

    sendMessageToGateway(ws, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 10));

    // Should have sent a welcome
    expect(ws.sentMessages.length).toBeGreaterThan(0);
    const welcome = JSON.parse(ws.sentMessages[0]) as {
      type: string;
      data: {
        pollInterval: number;
        config: {
          serverCompatLevel: string;
          supportedProtocols: string;
        };
      };
    };
    expect(welcome.type).toBe('welcome');
    expect(welcome.data.pollInterval).toBeGreaterThan(0);
    expect(welcome.data.config.serverCompatLevel).toBe('1.4');
    expect(welcome.data.config.supportedProtocols).toBe('lookout/1.0');
  });

  test('protocol lookout/1.0 is accepted', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { gateway, getUpgradedWs } = createGateway(record);
    const socket = createMockSocket();
    gateway.handleUpgrade(
      createRequest('/api/lookout/ws'),
      socket as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws = getUpgradedWs()!;
    sendMessageToGateway(ws, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 10));

    // Welcome should be the only sent frame on success
    const welcome = JSON.parse(ws.sentMessages[0]) as { type: string };
    expect(welcome.type).toBe('welcome');
  });
});

describe('version handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  test('welcome config includes serverCompatLevel=1.4 and supportedProtocols=lookout/1.0', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const nonce = 'f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const sig = signHello(privateKey, ts, nonce);

    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    const { gateway, getUpgradedWs } = createGateway(record);
    gateway.handleUpgrade(
      createRequest('/api/lookout/ws'),
      createMockSocket() as unknown as Socket,
      Buffer.alloc(0),
    );
    const ws = getUpgradedWs()!;
    sendMessageToGateway(ws, buildHello(keyId, ts, nonce, sig));
    await new Promise((r) => setTimeout(r, 10));

    const welcome = JSON.parse(ws.sentMessages[0]) as {
      data: { config: { serverCompatLevel: string; supportedProtocols: string } };
    };
    expect(welcome.data.config.serverCompatLevel).toBe('1.4');
    expect(welcome.data.config.supportedProtocols).toBe('lookout/1.0');
  });
});

describe('duplicate-agent guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNonceCacheForTesting();
  });

  /**
   * Sends a valid hello to the given gateway and waits for processing.
   * Returns the upgraded WebSocket.
   */
  async function sendValidHello(
    gateway: ReturnType<typeof createGateway>['gateway'],
    getUpgradedWs: ReturnType<typeof createGateway>['getUpgradedWs'],
    keyId: string,
    privateKey: import('node:crypto').KeyObject,
    pubkeyBase64: string,
    nonce: string,
  ) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signHello(privateKey, ts, nonce);
    const socket = createMockSocket();
    gateway.handleUpgrade(createRequest('/api/lookout/ws'), socket as unknown as Socket, Buffer.alloc(0));
    const ws = getUpgradedWs()!;
    sendMessageToGateway(ws, buildHello(keyId, ts, nonce, sig, { agentId: 'concurrent-agent' }));
    await new Promise((r) => setTimeout(r, 10));
    return ws;
  }

  test('agent-already-connected when manager already has the agent name', async () => {
    const { privateKey, pubkeyBase64, keyId } = generateKeyPair();
    const nonce = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5';
    const record: AgentKeyRecord = {
      keyId,
      pubkey: pubkeyBase64,
      label: 'test',
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };

    // Make getAgent return a truthy value for any agent name (simulate existing connection)
    const { getAgent } = await import('../agent/manager.js');
    vi.mocked(getAgent).mockReturnValue({ name: 'lookout-edge-concurrent-agent' } as unknown as Parameters<typeof getAgent>[0] extends string ? ReturnType<typeof getAgent> : never);

    const { gateway, getUpgradedWs } = createGateway(record);
    const ts = Math.floor(Date.now() / 1000);
    const sig = signHello(privateKey, ts, nonce);
    const socket = createMockSocket();
    gateway.handleUpgrade(createRequest('/api/lookout/ws'), socket as unknown as Socket, Buffer.alloc(0));
    const ws = getUpgradedWs()!;
    sendMessageToGateway(ws, buildHello(keyId, ts, nonce, sig, { agentId: 'concurrent-agent' }));
    await new Promise((r) => setTimeout(r, 10));

    const lastMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]) as {
      data: { code: string };
    };
    expect(lastMsg.data.code).toBe('agent-already-connected');
    expect(ws.close).toHaveBeenCalledWith(1008, 'agent-already-connected');
  });
});
