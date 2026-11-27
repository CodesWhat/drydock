import { verify as cryptoVerify, generateKeyPairSync } from 'node:crypto';
import axios from 'axios';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

vi.mock('axios');
vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));
vi.mock('../runtime/paths.js', () => ({ resolveConfiguredPath: vi.fn((path) => path) }));
vi.mock('../security/sbom-migration.js', () => ({ offloadSbomDocuments: vi.fn() }));
vi.mock('../security/sbom-storage.js', () => ({ createSbomStorage: vi.fn() }));
vi.mock('../store/index.js', () => ({ getConfiguration: vi.fn(() => ({ path: '/store' })) }));
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../log/index.js', () => ({ default: { child: () => mockLog } }));
vi.mock('../store/container.js', () => ({
  getContainers: vi.fn().mockReturnValue([]),
  getContainer: vi.fn(),
  insertContainer: vi.fn((c) => c),
  updateContainer: vi.fn((c) => c),
  deleteContainer: vi.fn(),
}));
vi.mock('./agent-version-alerts.js', () => ({ checkAgentVersion: vi.fn() }));
vi.mock('../event/index.js', () => ({
  emitAgentConnected: vi.fn().mockResolvedValue(undefined),
  emitAgentDisconnected: vi.fn().mockResolvedValue(undefined),
  emitAgentStatsChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn(),
  registerComponent: vi.fn(),
  getState: vi.fn(() => ({
    trigger: {},
    watcher: {},
    registry: {},
    authentication: {},
    agent: {},
  })),
}));

const pinStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./portwing-audience.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./portwing-audience.js')>()),
  getAudiencePinStore: () => pinStore,
}));

import { AgentClient } from './AgentClient.js';
import { bodySha256Hex, buildCanonicalMessageV3 } from './ed25519-signer.js';
import { AudienceMismatchError } from './portwing-audience.js';

const KEY_ID = 'deadbeefcafef00d';
const AGENT_ID = 'agent-a-0123456789abcdef0123456789abcdef';
const OTHER_ID = 'agent-b-fedcba9876543210fedcba9876543210';

describe('AgentClient signature v3 audience', () => {
  let privateKeyPem: string;
  let publicKey: ReturnType<typeof generateKeyPairSync<'ed25519'>>['publicKey'];

  beforeAll(() => {
    const pair = generateKeyPairSync('ed25519');
    publicKey = pair.publicKey;
    privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    pinStore.get.mockReturnValue(undefined);
  });

  function makeClient(overrides: Record<string, unknown> = {}) {
    return new AgentClient('edge', {
      host: 'agent-host',
      port: 3001,
      secret: '',
      authmode: 'ed25519',
      signingkeyid: KEY_ID,
      signingkey: privateKeyPem,
      ...overrides,
    });
  }

  function info(body: Record<string, unknown>, status = 200, headers = {}) {
    return { status, data: body, headers };
  }

  function headersOfCall(call: unknown[]) {
    return (call[1] as { headers: Record<string, string> }).headers;
  }

  function expectV3(
    headers: Record<string, string>,
    audience: string,
    method: string,
    path: string,
  ) {
    expect(headers['X-Portwing-Signature-Version']).toBe('3');
    expect(headers['X-Portwing-Audience']).toBe(audience);
    const canonical = buildCanonicalMessageV3(
      audience,
      method,
      path,
      bodySha256Hex(Buffer.alloc(0)),
      Number(headers['X-Portwing-Timestamp']),
      headers['X-Portwing-Nonce'],
    );
    expect(
      cryptoVerify(
        null,
        Buffer.from(canonical, 'utf8'),
        publicKey,
        Buffer.from(headers['X-Portwing-Signature'], 'base64url'),
      ),
    ).toBe(true);
  }

  async function settle() {
    await vi.waitFor(() => expect(axios).toHaveBeenCalled());
  }

  describe('starting state', () => {
    test('signs version 2 with no pin and no override', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue({ data: {} });
      await client.getWatcher('docker', 'local');
      expect(headersOfCall(axios.get.mock.calls[0])['X-Portwing-Signature-Version']).toBe('2');
    });

    test('signs version 3 for a pin saved by an earlier accepted v3 request', async () => {
      pinStore.get.mockReturnValue(AGENT_ID);
      const client = makeClient();
      axios.get.mockResolvedValue({ data: {} });
      await client.getWatcher('docker', 'local');
      expectV3(
        headersOfCall(axios.get.mock.calls[0]),
        AGENT_ID,
        'GET',
        '/api/watchers/docker/local',
      );
      expect(pinStore.get).toHaveBeenCalledWith('edge');
    });

    test('the operator audience override wins over a saved pin', async () => {
      pinStore.get.mockReturnValue(OTHER_ID);
      const client = makeClient({ audience: AGENT_ID });
      axios.get.mockResolvedValue({ data: {} });
      await client.getWatcher('docker', 'local');
      expect(headersOfCall(axios.get.mock.calls[0])['X-Portwing-Audience']).toBe(AGENT_ID);
    });

    test('rejects an override outside the agent ID rule', () => {
      expect(() => makeClient({ audience: 'Bad_ID' })).toThrow(/invalid audience/);
    });

    test('token mode never touches the pin store', () => {
      new AgentClient('plain', { host: 'https://h', port: 1, secret: 's' });
      expect(pinStore.get).not.toHaveBeenCalled();
    });

    test('an unreadable pin file stops signing instead of falling back to v2', async () => {
      pinStore.get.mockImplementation(() => {
        throw new Error('Unexpected token');
      });
      const client = makeClient();
      await expect(client.getWatcher('docker', 'local')).rejects.toThrow(/pin file is unreadable/);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('first contact', () => {
    test('reads the ID with v2, confirms v3, pins it and then signs v3', async () => {
      const client = makeClient();
      axios.get
        .mockResolvedValueOnce(info({ agentId: AGENT_ID, v3: true }))
        .mockResolvedValueOnce(info({ agentId: AGENT_ID, v3: true }))
        .mockResolvedValue({ data: {} });
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });

      client.startSse();
      await settle();

      const [first, second] = axios.get.mock.calls;
      expect(first[0]).toBe('http://agent-host:3001/_portwing/info');
      expect(headersOfCall(first)['X-Portwing-Signature-Version']).toBe('2');
      expectV3(headersOfCall(second), AGENT_ID, 'GET', '/_portwing/info');
      expect(pinStore.set).toHaveBeenCalledWith('edge', AGENT_ID);

      expectV3(axios.mock.calls[0][0].headers, AGENT_ID, 'GET', '/api/events');
      client.stop();
    });

    test('does not open the stream when stopped while the agent ID is being checked', async () => {
      const client = makeClient();
      let release!: (value: unknown) => void;
      axios.get.mockReturnValue(new Promise((resolve) => (release = resolve)));
      client.startSse();
      client.stop();
      release(info({ agentId: AGENT_ID }));
      await vi.waitFor(() => expect(mockLog.info).toHaveBeenCalled());
      expect(axios).not.toHaveBeenCalled();
    });

    test('the info request accepts any status so refusal reasons can be read', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({ agentId: AGENT_ID }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      const config = axios.get.mock.calls[0][1] as { validateStatus(status: number): boolean };
      expect(config.validateStatus(401)).toBe(true);
    });

    test('an agent without v3 stays on v2 and nothing is pinned', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(
        info({ agentId: 'Agent_ID', v3: false, v3Reason: 'agent-id-not-v3-compatible' }),
      );
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(pinStore.set).not.toHaveBeenCalled();
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('2');
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('agent-id-not-v3-compatible'),
      );
    });

    test('an agent without v3 and no stated reason logs no reason', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({ agentId: AGENT_ID }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/does not offer signature v3; signing with v2$/),
      );
    });

    test('a failed info request keeps v2 and pins nothing', async () => {
      const client = makeClient();
      axios.get.mockRejectedValue(new Error('connect ECONNREFUSED'));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(pinStore.set).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('2');
    });

    test('a non-2xx info response is reported with its reason and pins nothing', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(
        info({}, 401, { 'x-portwing-reason': 'signature-version-too-low' }),
      );
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('status 401 (signature-version-too-low)'),
      );
      expect(pinStore.set).not.toHaveBeenCalled();
    });

    test('a non-2xx info response without a reason header still reports the status', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue({ status: 500, data: {} });
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringMatching(/status 500\)$/));
    });

    test('a confirmation that reports another ID stops signing and pins nothing', async () => {
      const client = makeClient();
      axios.get
        .mockResolvedValueOnce(info({ agentId: AGENT_ID, v3: true }))
        .mockResolvedValueOnce(info({ agentId: OTHER_ID, v3: true }));
      client.startSse();
      await vi.waitFor(() => expect(mockLog.error).toHaveBeenCalled());
      expect(pinStore.set).not.toHaveBeenCalled();
      await expect(client.getWatcher('docker', 'local')).rejects.toBeInstanceOf(
        AudienceMismatchError,
      );
    });

    test('a v3 refusal after the v2 read leaves the client on v2', async () => {
      const client = makeClient();
      axios.get
        .mockResolvedValueOnce(info({ agentId: AGENT_ID, v3: true }))
        .mockResolvedValueOnce(info({}, 401, { 'x-portwing-reason': 'state-not-writable' }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(pinStore.set).not.toHaveBeenCalled();
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('2');
    });
  });

  describe('a pinned agent', () => {
    beforeEach(() => {
      pinStore.get.mockReturnValue(AGENT_ID);
    });

    test('is checked with a v3 info request and keeps signing v3', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({ agentId: AGENT_ID, v3: true }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expectV3(headersOfCall(axios.get.mock.calls[0]), AGENT_ID, 'GET', '/_portwing/info');
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(pinStore.set).not.toHaveBeenCalled();
    });

    test('never falls back to v2 when info later says v3 is unavailable', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(
        info({ agentId: AGENT_ID, v3: false, v3Reason: 'state-not-writable' }),
      );
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('3');
    });

    test('keeps v3 after an invalid-signature response', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({}, 401, { 'x-portwing-reason': 'invalid-signature' }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('3');
    });

    test('stops signing when the agent reports a different ID', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({ agentId: OTHER_ID, v3: true }));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await vi.waitFor(() => expect(mockLog.error).toHaveBeenCalled());
      await vi.waitFor(() =>
        expect(mockLog.error).toHaveBeenCalledWith(
          expect.stringContaining('SSE Connection not opened'),
        ),
      );
      expect(axios).not.toHaveBeenCalled();
      axios.get.mockClear();
      await expect(client.getWatcher('docker', 'local')).rejects.toThrow(OTHER_ID);
      expect(axios.get).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('portwing-audience-pins.json'),
      );
      client.stop();
    });

    test('stops signing on an audience-mismatch refusal', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({}, 401, { 'x-portwing-reason': 'audience-mismatch' }));
      client.startSse();
      await vi.waitFor(() => expect(mockLog.error).toHaveBeenCalled());
      await expect(client.getWatcher('docker', 'local')).rejects.toBeInstanceOf(
        AudienceMismatchError,
      );
      client.stop();
    });

    test('a pinned agent with no ID in its answer is not treated as a mismatch', async () => {
      const client = makeClient();
      axios.get.mockResolvedValue(info({}));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(mockLog.error).not.toHaveBeenCalled();
    });

    test('a failed check keeps the pin and v3', async () => {
      const client = makeClient();
      axios.get.mockRejectedValue(new Error('timeout'));
      axios.mockResolvedValue({ data: { on: vi.fn(), destroy: vi.fn() } });
      client.startSse();
      await settle();
      expect(axios.mock.calls[0][0].headers['X-Portwing-Signature-Version']).toBe('3');
    });
  });
});
