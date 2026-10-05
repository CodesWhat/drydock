/**
 * Tests for the Portwing pubkey management HTTP API.
 */
import { generateKeyPairSync } from 'node:crypto';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

// Route handlers and mocks all hoisted so they are available before imports
const { capturedHandlers, mockAgentKeys, mockSendErrorResponse, mockDisconnectByKeyId } =
  vi.hoisted(() => {
    const handlers: {
      getKeys?: (req: unknown, res: unknown) => void;
      postKeys?: (req: unknown, res: unknown) => void;
      deleteKey?: (req: unknown, res: unknown) => void;
    } = {};

    class AgentKeyConflictError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'AgentKeyConflictError';
      }
    }

    return {
      capturedHandlers: handlers,
      mockAgentKeys: {
        listKeys: vi.fn(() => []),
        addKey: vi.fn(),
        revokeKey: vi.fn(() => false),
        AgentKeyConflictError,
      },
      mockSendErrorResponse: vi.fn(),
      mockDisconnectByKeyId: vi.fn(() => 0),
    };
  });

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      get: vi.fn((path: string, handler: (req: unknown, res: unknown) => void) => {
        if (path === '/keys') capturedHandlers.getKeys = handler;
      }),
      post: vi.fn((path: string, handler: (req: unknown, res: unknown) => void) => {
        if (path === '/keys') capturedHandlers.postKeys = handler;
      }),
      delete: vi.fn((path: string, handler: (req: unknown, res: unknown) => void) => {
        if (path === '/keys/:keyId') capturedHandlers.deleteKey = handler;
      }),
    })),
  },
}));

vi.mock('../store/agent-keys.js', () => mockAgentKeys);
vi.mock('./error-response.js', () => ({ sendErrorResponse: mockSendErrorResponse }));
vi.mock('./portwing-ws.js', () => ({ disconnectByKeyId: mockDisconnectByKeyId }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import * as portwingRouterModule from './portwing.js';

// Initialize the router once to register all handlers and capture them
portwingRouterModule.init();

function generateEd25519RawPubkey(): Buffer {
  const { publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return spki.subarray(12);
}

describe('Portwing Router — init', () => {
  test('registers GET /keys', () => {
    expect(capturedHandlers.getKeys).toBeDefined();
  });

  test('registers POST /keys', () => {
    expect(capturedHandlers.postKeys).toBeDefined();
  });

  test('registers DELETE /keys/:keyId', () => {
    expect(capturedHandlers.deleteKey).toBeDefined();
  });
});

describe('GET /keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns empty array when no keys exist', () => {
    mockAgentKeys.listKeys.mockReturnValue([]);
    const res = createMockResponse();
    capturedHandlers.getKeys!(createMockRequest(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('returns all keys when present', () => {
    const keys = [
      {
        keyId: 'aabbccddeeff0011',
        pubkey: 'abc',
        label: 'agent1',
        createdAt: '2026-01-01T00:00:00Z',
        revokedAt: null,
      },
    ];
    mockAgentKeys.listKeys.mockReturnValue(keys);
    const res = createMockResponse();
    capturedHandlers.getKeys!(createMockRequest(), res);
    expect(res.json).toHaveBeenCalledWith(keys);
  });
});

describe('POST /keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 400 when pubkeyBase64 is missing', () => {
    const req = createMockRequest({ body: { label: 'agent' } });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      400,
      expect.stringContaining('pubkeyBase64'),
    );
  });

  test('returns 400 when label is missing', () => {
    const rawKey = generateEd25519RawPubkey();
    const req = createMockRequest({ body: { pubkeyBase64: rawKey.toString('base64') } });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, expect.stringContaining('label'));
  });

  test('returns 400 when base64 decodes to wrong length', () => {
    const shortKey = Buffer.alloc(16).toString('base64');
    const req = createMockRequest({ body: { pubkeyBase64: shortKey, label: 'agent' } });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      400,
      expect.stringContaining('32 bytes'),
    );
  });

  test('returns 400 when pubkeyBase64 is empty string', () => {
    const req = createMockRequest({ body: { pubkeyBase64: '', label: 'agent' } });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, expect.any(String));
  });

  test('returns 400 when pubkeyBase64 decodes to zero bytes (padding-only base64)', () => {
    // '====' is a non-empty string that passes the truthy check but decodes to 0 bytes
    const req = createMockRequest({ body: { pubkeyBase64: '====', label: 'agent' } });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      400,
      expect.stringContaining('does not decode'),
    );
  });

  test('returns 201 with keyId/label/createdAt for valid 32-byte key', () => {
    const rawKey = generateEd25519RawPubkey();
    const record = {
      keyId: 'aabbccddeeff0011',
      pubkey: rawKey.toString('base64'),
      label: 'agent',
      createdAt: '2026-01-01T00:00:00Z',
      revokedAt: null,
    };
    mockAgentKeys.addKey.mockReturnValue(record);

    const req = createMockRequest({
      body: { pubkeyBase64: rawKey.toString('base64'), label: 'agent' },
    });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      keyId: record.keyId,
      label: record.label,
      createdAt: record.createdAt,
    });
  });

  test('returns 409 when addKey throws AgentKeyConflictError (duplicate key)', () => {
    const rawKey = generateEd25519RawPubkey();
    mockAgentKeys.addKey.mockImplementation(() => {
      throw new mockAgentKeys.AgentKeyConflictError('Key aabbccddeeff0011 is already active');
    });

    const req = createMockRequest({
      body: { pubkeyBase64: rawKey.toString('base64'), label: 'duplicate' },
    });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      409,
      'Key aabbccddeeff0011 is already active',
    );
  });

  test('returns 500 with a generic message when addKey throws an unexpected (non-conflict) error', () => {
    const rawKey = generateEd25519RawPubkey();
    mockAgentKeys.addKey.mockImplementation(() => {
      throw new Error('agent-keys collection not initialized');
    });

    const req = createMockRequest({
      body: { pubkeyBase64: rawKey.toString('base64'), label: 'agent' },
    });
    const res = createMockResponse();
    capturedHandlers.postKeys!(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 500, 'Internal server error');
  });
});

describe('POST /keys from a session that signed in with a recovery code', () => {
  const localIdentity = (assurance: 'password' | 'totp' | 'recovery') => ({
    type: 'local',
    subjectId: 's'.repeat(64),
    providerId: 'basic.default',
    assurance,
    factorVersion: 1,
    issuedAt: 1,
  });
  const record = {
    keyId: 'aabbccddeeff0011',
    pubkey: 'unused',
    label: 'agent',
    createdAt: '2026-01-01T00:00:00Z',
    revokedAt: null,
  };
  const validBody = () => ({
    pubkeyBase64: generateEd25519RawPubkey().toString('base64'),
    label: 'agent',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentKeys.addKey.mockReturnValue(record);
  });

  test('is refused with 403 and the reason, and no key is registered', () => {
    const res = createMockResponse();

    capturedHandlers.postKeys!(
      createMockRequest({
        body: validBody(),
        principal: { kind: 'session', username: 'scott', identity: localIdentity('recovery') },
      }),
      res,
    );

    expect(mockSendErrorResponse).toHaveBeenCalledTimes(1);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 403, {
      message:
        'A session that signed in with a recovery code cannot register agent keys. Sign in with a code from your authenticator app and try again.',
      details: { reason: 'recovery-assurance' },
    });
    expect(mockAgentKeys.addKey).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('is refused before the body is looked at, so a malformed one is the same 403', () => {
    const res = createMockResponse();

    capturedHandlers.postKeys!(
      createMockRequest({
        body: { label: 7 },
        principal: { kind: 'session', username: 'scott', identity: localIdentity('recovery') },
      }),
      res,
    );

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      403,
      expect.objectContaining({ details: { reason: 'recovery-assurance' } }),
    );
  });

  test('can still list keys and revoke one', () => {
    const principal = { kind: 'session', username: 'scott', identity: localIdentity('recovery') };
    mockAgentKeys.listKeys.mockReturnValue([record]);
    mockAgentKeys.revokeKey.mockReturnValue(true);

    const listRes = createMockResponse();
    capturedHandlers.getKeys!(createMockRequest({ principal }), listRes);
    expect(listRes.json).toHaveBeenCalledWith([record]);

    const revokeRes = createMockResponse();
    capturedHandlers.deleteKey!(
      createMockRequest({ params: { keyId: record.keyId }, principal }),
      revokeRes,
    );
    expect(revokeRes.status).toHaveBeenCalledWith(204);
    expect(mockSendErrorResponse).not.toHaveBeenCalled();
  });

  test.each([
    ['a code from the authenticator app', { identity: localIdentity('totp') }],
    ['a password and no factor', { identity: localIdentity('password') }],
    ['an OIDC provider', { identity: { type: 'oidc' } }],
    ['a release before two-factor support', {}],
  ])('a session that signed in with %s still registers a key', (_name, identity) => {
    const res = createMockResponse();

    capturedHandlers.postKeys!(
      createMockRequest({
        body: validBody(),
        principal: { kind: 'session', username: 'scott', ...identity },
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSendErrorResponse).not.toHaveBeenCalled();
  });

  test('an API key caller gets the session-only refusal it always got, not this one', () => {
    const res = createMockResponse();

    capturedHandlers.postKeys!(
      createMockRequest({
        body: validBody(),
        principal: { kind: 'api-key', username: 'ci', keyId: 'k1', scopes: ['admin'] },
      }),
      res,
    );

    expect(mockSendErrorResponse).toHaveBeenCalledTimes(1);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 403, {
      message: 'This route is not reachable with an API key',
    });
    expect(mockAgentKeys.addKey).not.toHaveBeenCalled();
  });
});

describe('DELETE /keys/:keyId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 204 when key is found and revoked', () => {
    mockAgentKeys.revokeKey.mockReturnValue(true);
    const req = createMockRequest({ params: { keyId: 'aabbccddeeff0011' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  test('returns 404 when key is not found', () => {
    mockAgentKeys.revokeKey.mockReturnValue(false);
    const req = createMockRequest({ params: { keyId: '0000000000000000' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      404,
      expect.stringContaining('not found'),
    );
  });

  test('returns 400 for keyId that is too short', () => {
    const req = createMockRequest({ params: { keyId: 'abc123' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, 'Invalid keyId format');
    expect(mockAgentKeys.revokeKey).not.toHaveBeenCalled();
  });

  test('returns 400 for keyId that is too long', () => {
    const req = createMockRequest({ params: { keyId: 'aabbccddeeff001122' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, 'Invalid keyId format');
    expect(mockAgentKeys.revokeKey).not.toHaveBeenCalled();
  });

  test('returns 400 for keyId with uppercase hex', () => {
    const req = createMockRequest({ params: { keyId: 'AABBCCDDEEFF0011' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, 'Invalid keyId format');
    expect(mockAgentKeys.revokeKey).not.toHaveBeenCalled();
  });

  test('returns 400 for keyId with non-hex characters (path traversal attempt)', () => {
    const req = createMockRequest({ params: { keyId: '../../../../etc/pass' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 400, 'Invalid keyId format');
    expect(mockAgentKeys.revokeKey).not.toHaveBeenCalled();
  });

  test('400 error message is fixed (does not reflect the raw keyId)', () => {
    const injected = 'INJECTED_VALUE0000';
    const req = createMockRequest({ params: { keyId: injected } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    const [[, , msg]] = mockSendErrorResponse.mock.calls as [[unknown, number, string]];
    expect(msg).not.toContain(injected);
    expect(msg).toBe('Invalid keyId format');
  });

  test('calls disconnectByKeyId after successful revocation', () => {
    mockAgentKeys.revokeKey.mockReturnValue(true);
    mockDisconnectByKeyId.mockReturnValue(1);
    const req = createMockRequest({ params: { keyId: 'aabbccddeeff0011' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockDisconnectByKeyId).toHaveBeenCalledWith('aabbccddeeff0011');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  test('does NOT call disconnectByKeyId when key not found (revokeKey returns false)', () => {
    mockAgentKeys.revokeKey.mockReturnValue(false);
    const req = createMockRequest({ params: { keyId: '0000000000000000' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockDisconnectByKeyId).not.toHaveBeenCalled();
    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      404,
      expect.stringContaining('not found'),
    );
  });

  test('does NOT call disconnectByKeyId when keyId format is invalid', () => {
    const req = createMockRequest({ params: { keyId: 'bad-key-id' } });
    const res = createMockResponse();
    capturedHandlers.deleteKey!(req, res);
    expect(mockDisconnectByKeyId).not.toHaveBeenCalled();
  });
});
