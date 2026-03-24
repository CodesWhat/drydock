import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockDockerodeCtor,
  mockReadFileSync,
  mockResolveConfiguredPath,
  mockGetErrorMessage,
  mockInitializeRemoteOidcStateFromConfiguration,
  mockIsRemoteOidcTokenRefreshRequired,
  mockRefreshRemoteOidcAccessToken,
  mockProbeSocketApiVersion,
} = vi.hoisted(() => ({
  mockDockerodeCtor: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockResolveConfiguredPath: vi.fn((value: string) => `/resolved/${value}`),
  mockGetErrorMessage: vi.fn((_: unknown, fallback: string) => fallback),
  mockInitializeRemoteOidcStateFromConfiguration: vi.fn(),
  mockIsRemoteOidcTokenRefreshRequired: vi.fn(() => false),
  mockRefreshRemoteOidcAccessToken: vi.fn(),
  mockProbeSocketApiVersion: vi.fn<(socketPath: string) => Promise<string | undefined>>(),
}));

vi.mock('dockerode', () => ({
  default: mockDockerodeCtor,
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
  },
}));

vi.mock('../../../runtime/paths.js', () => ({
  resolveConfiguredPath: mockResolveConfiguredPath,
}));

vi.mock('./docker-helpers.js', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

vi.mock('./oidc.js', () => ({
  initializeRemoteOidcStateFromConfiguration: mockInitializeRemoteOidcStateFromConfiguration,
  isRemoteOidcTokenRefreshRequired: mockIsRemoteOidcTokenRefreshRequired,
  refreshRemoteOidcAccessToken: mockRefreshRemoteOidcAccessToken,
}));

vi.mock('./socket-version-probe.js', () => ({
  probeSocketApiVersion: mockProbeSocketApiVersion,
}));

import {
  applyRemoteAuthHeadersForWatcher,
  ensureRemoteAuthHeadersForWatcher,
  initWatcherWithRemoteAuth,
} from './docker-remote-auth.js';

function createWatcher(overrides: Record<string, unknown> = {}) {
  const defaultWatcher = {
    name: 'watcher-a',
    dockerApi: undefined,
    remoteAuthBlockedReason: undefined,
    remoteOidcAccessToken: undefined,
    configuration: {
      socket: '/var/run/docker.sock',
      port: 2375,
    },
    log: {
      warn: vi.fn(),
    },
    applyRemoteAuthHeaders: vi.fn(),
    getRemoteAuthResolution: vi.fn(() => ({
      authType: '',
      hasBearer: false,
      hasBasic: false,
      hasOidcConfig: false,
    })),
    isHttpsRemoteWatcher: vi.fn(() => true),
    handleRemoteAuthFailure: vi.fn(),
    getOidcContext: vi.fn(() => ({ watcherName: 'watcher-a' })),
    getOidcStateAdapter: vi.fn(() => ({})),
    setRemoteAuthorizationHeader: vi.fn(),
  };

  return {
    ...defaultWatcher,
    ...overrides,
    configuration: {
      ...defaultWatcher.configuration,
      ...((overrides.configuration as Record<string, unknown>) || {}),
    },
    log: {
      ...defaultWatcher.log,
      ...((overrides.log as Record<string, unknown>) || {}),
    },
  };
}

describe('docker remote auth module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfiguredPath.mockImplementation((value: string) => `/resolved/${value}`);
    mockGetErrorMessage.mockImplementation((_: unknown, fallback: string) => fallback);
    mockIsRemoteOidcTokenRefreshRequired.mockReturnValue(false);
    mockRefreshRemoteOidcAccessToken.mockResolvedValue(undefined);
    mockProbeSocketApiVersion.mockResolvedValue(undefined);
  });

  test('initWatcherWithRemoteAuth initializes local socket watcher', async () => {
    const dockerApi = { modem: { headers: {} } };
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return dockerApi;
    });

    const watcher = createWatcher({
      configuration: {
        socket: '/var/run/docker.sock',
        port: 0,
      },
    });

    await initWatcherWithRemoteAuth(watcher as any);

    expect(mockProbeSocketApiVersion).toHaveBeenCalledWith('/var/run/docker.sock');
    expect(mockDockerodeCtor).toHaveBeenCalledWith({
      socketPath: '/var/run/docker.sock',
    });
    expect(watcher.applyRemoteAuthHeaders).not.toHaveBeenCalled();
    expect(watcher.remoteAuthBlockedReason).toBeUndefined();
    expect(watcher.dockerApi).toBe(dockerApi);
  });

  test('initWatcherWithRemoteAuth pins API version when probe succeeds', async () => {
    const dockerApi = { modem: { headers: {} } };
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return dockerApi;
    });
    mockProbeSocketApiVersion.mockResolvedValue('1.44');

    const watcher = createWatcher({
      configuration: {
        socket: '/run/podman/podman.sock',
        port: 0,
      },
    });

    await initWatcherWithRemoteAuth(watcher as any);

    expect(mockProbeSocketApiVersion).toHaveBeenCalledWith('/run/podman/podman.sock');
    expect(mockDockerodeCtor).toHaveBeenCalledWith({
      socketPath: '/run/podman/podman.sock',
      version: 'v1.44',
    });
    expect(watcher.dockerApi).toBe(dockerApi);
  });

  test('initWatcherWithRemoteAuth loads TLS files and applies headers for remote watcher', async () => {
    const dockerApi = { modem: { headers: {} } };
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return dockerApi;
    });
    mockReadFileSync.mockImplementation((pathValue: string) =>
      Buffer.from(`contents:${pathValue}`, 'utf8'),
    );

    const watcher = createWatcher({
      name: 'remote-watcher',
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        protocol: 'https',
        cafile: 'ca.pem',
        certfile: 'cert.pem',
        keyfile: 'key.pem',
      },
    });

    await initWatcherWithRemoteAuth(watcher as any);

    expect(mockResolveConfiguredPath).toHaveBeenCalledWith('ca.pem', {
      label: 'watcher remote-watcher CA file path',
    });
    expect(mockResolveConfiguredPath).toHaveBeenCalledWith('cert.pem', {
      label: 'watcher remote-watcher certificate file path',
    });
    expect(mockResolveConfiguredPath).toHaveBeenCalledWith('key.pem', {
      label: 'watcher remote-watcher key file path',
    });
    expect(mockReadFileSync).toHaveBeenCalledWith('/resolved/ca.pem');
    expect(mockReadFileSync).toHaveBeenCalledWith('/resolved/cert.pem');
    expect(mockReadFileSync).toHaveBeenCalledWith('/resolved/key.pem');
    expect(watcher.applyRemoteAuthHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'docker-api.example.com',
        port: 443,
        protocol: 'https',
        ca: Buffer.from('contents:/resolved/ca.pem', 'utf8'),
        cert: Buffer.from('contents:/resolved/cert.pem', 'utf8'),
        key: Buffer.from('contents:/resolved/key.pem', 'utf8'),
      }),
    );
    expect(mockDockerodeCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'docker-api.example.com',
        port: 443,
        protocol: 'https',
      }),
    );
    expect(watcher.remoteAuthBlockedReason).toBeUndefined();
    expect(watcher.dockerApi).toBe(dockerApi);
  });

  test('initWatcherWithRemoteAuth does not probe version for remote host watchers', async () => {
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return { modem: { headers: {} } };
    });

    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        protocol: 'https',
      },
    });

    await initWatcherWithRemoteAuth(watcher as any);

    expect(mockProbeSocketApiVersion).not.toHaveBeenCalled();
  });

  test('initWatcherWithRemoteAuth blocks remote watcher auth when header application fails', async () => {
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return { modem: { headers: {} } };
    });
    mockGetErrorMessage.mockReturnValue('auth failed');

    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
      },
      applyRemoteAuthHeaders: vi.fn(() => {
        throw new Error('bad auth');
      }),
    });

    await initWatcherWithRemoteAuth(watcher as any);

    expect(mockGetErrorMessage).toHaveBeenCalledWith(
      expect.any(Error),
      'Unable to authenticate remote watcher watcher-a',
    );
    expect(watcher.remoteAuthBlockedReason).toBe('auth failed');
    expect(watcher.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('auth is blocked (auth failed)'),
    );
    expect(mockDockerodeCtor).toHaveBeenCalledTimes(1);
  });

  test('ensureRemoteAuthHeadersForWatcher throws when watcher auth is blocked', async () => {
    const watcher = createWatcher({
      remoteAuthBlockedReason: 'blocked by previous init error',
    });

    await expect(ensureRemoteAuthHeadersForWatcher(watcher as any)).rejects.toThrow(
      'blocked by previous init error',
    );
  });

  test('ensureRemoteAuthHeadersForWatcher skips when host or auth is not configured', async () => {
    const watcher = createWatcher({
      configuration: {
        socket: '/var/run/docker.sock',
        port: 0,
      },
    });

    await ensureRemoteAuthHeadersForWatcher(watcher as any);

    expect(watcher.getRemoteAuthResolution).not.toHaveBeenCalled();
    expect(watcher.setRemoteAuthorizationHeader).not.toHaveBeenCalled();
  });

  test('ensureRemoteAuthHeadersForWatcher skips non-oidc auth types', async () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        auth: {
          type: 'bearer',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'bearer',
      })),
    });

    await ensureRemoteAuthHeadersForWatcher(watcher as any);

    expect(watcher.getRemoteAuthResolution).toHaveBeenCalledWith({
      type: 'bearer',
    });
    expect(watcher.isHttpsRemoteWatcher).not.toHaveBeenCalled();
    expect(watcher.setRemoteAuthorizationHeader).not.toHaveBeenCalled();
  });

  test('ensureRemoteAuthHeadersForWatcher fails closed when oidc is not over HTTPS', async () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 2375,
        protocol: 'http',
        auth: {
          type: 'oidc',
          oidc: {
            tokenurl: 'https://idp.example.com/token',
          },
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'oidc',
      })),
      isHttpsRemoteWatcher: vi.fn(() => false),
    });

    await ensureRemoteAuthHeadersForWatcher(watcher as any);

    expect(watcher.handleRemoteAuthFailure).toHaveBeenCalledWith(
      'Unable to authenticate remote watcher watcher-a: HTTPS is required for OIDC auth (set protocol=https or TLS certificates)',
    );
    expect(mockInitializeRemoteOidcStateFromConfiguration).not.toHaveBeenCalled();
    expect(mockRefreshRemoteOidcAccessToken).not.toHaveBeenCalled();
  });

  test('ensureRemoteAuthHeadersForWatcher refreshes oidc token when required', async () => {
    const oidcContext = { watcherName: 'watcher-a' };
    const oidcState = { accessToken: undefined };
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'oidc',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'oidc',
      })),
      getOidcContext: vi.fn(() => oidcContext),
      getOidcStateAdapter: vi.fn(() => oidcState),
    });
    mockIsRemoteOidcTokenRefreshRequired.mockReturnValue(true);
    mockRefreshRemoteOidcAccessToken.mockImplementation(async () => {
      watcher.remoteOidcAccessToken = 'refreshed-access-token';
    });

    await ensureRemoteAuthHeadersForWatcher(watcher as any);

    expect(mockInitializeRemoteOidcStateFromConfiguration).toHaveBeenCalledWith(oidcContext);
    expect(mockIsRemoteOidcTokenRefreshRequired).toHaveBeenCalledWith(oidcState);
    expect(mockRefreshRemoteOidcAccessToken).toHaveBeenCalledWith(oidcContext);
    expect(watcher.setRemoteAuthorizationHeader).toHaveBeenCalledWith(
      'Bearer refreshed-access-token',
    );
  });

  test('ensureRemoteAuthHeadersForWatcher throws when oidc token is unavailable after refresh', async () => {
    const oidcContext = { watcherName: 'watcher-a' };
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'oidc',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'oidc',
      })),
      getOidcContext: vi.fn(() => oidcContext),
    });
    mockIsRemoteOidcTokenRefreshRequired.mockReturnValue(true);
    mockRefreshRemoteOidcAccessToken.mockResolvedValue(undefined);

    await expect(ensureRemoteAuthHeadersForWatcher(watcher as any)).rejects.toThrow(
      'Unable to authenticate remote watcher watcher-a: no OIDC access token available',
    );

    expect(mockInitializeRemoteOidcStateFromConfiguration).toHaveBeenCalledWith(oidcContext);
    expect(mockRefreshRemoteOidcAccessToken).toHaveBeenCalledWith(oidcContext);
    expect(watcher.setRemoteAuthorizationHeader).not.toHaveBeenCalled();
  });

  test('applyRemoteAuthHeadersForWatcher returns when auth is missing', () => {
    const watcher = createWatcher();
    const options: Record<string, unknown> = {};

    applyRemoteAuthHeadersForWatcher(watcher as any, options as any);

    expect(watcher.getRemoteAuthResolution).not.toHaveBeenCalled();
    expect(watcher.handleRemoteAuthFailure).not.toHaveBeenCalled();
    expect(options.headers).toBeUndefined();
  });

  test('applyRemoteAuthHeadersForWatcher fails when credentials are incomplete', () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        auth: {
          type: 'basic',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'basic',
        hasBearer: false,
        hasBasic: false,
        hasOidcConfig: false,
      })),
    });
    const options: Record<string, unknown> = {};

    applyRemoteAuthHeadersForWatcher(watcher as any, options as any);

    expect(watcher.handleRemoteAuthFailure).toHaveBeenCalledWith(
      'Unable to authenticate remote watcher watcher-a: credentials are incomplete',
    );
    expect(watcher.isHttpsRemoteWatcher).not.toHaveBeenCalled();
    expect(options.headers).toBeUndefined();
  });

  test('applyRemoteAuthHeadersForWatcher fails when remote auth is not over HTTPS', () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 2375,
        protocol: 'http',
        auth: {
          bearer: 'token-1',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'bearer',
        hasBearer: true,
        hasBasic: false,
        hasOidcConfig: false,
      })),
      isHttpsRemoteWatcher: vi.fn(() => false),
    });

    applyRemoteAuthHeadersForWatcher(watcher as any, {} as any);

    expect(watcher.handleRemoteAuthFailure).toHaveBeenCalledWith(
      'Unable to authenticate remote watcher watcher-a: HTTPS is required for remote auth (set protocol=https or TLS certificates)',
    );
  });

  test('applyRemoteAuthHeadersForWatcher sets basic authorization header', () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        auth: {
          user: 'alice',
          password: 'secret',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'basic',
        hasBearer: false,
        hasBasic: true,
        hasOidcConfig: false,
      })),
    });
    const options: Record<string, any> = {
      headers: {
        'X-Test': '1',
      },
    };

    applyRemoteAuthHeadersForWatcher(watcher as any, options as any);

    expect(options.headers).toEqual({
      'X-Test': '1',
      Authorization: `Basic ${Buffer.from('alice:secret').toString('base64')}`,
    });
  });

  test('applyRemoteAuthHeadersForWatcher sets bearer authorization header', () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        auth: {
          bearer: 'token-abc',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'bearer',
        hasBearer: true,
        hasBasic: false,
        hasOidcConfig: false,
      })),
    });
    const options: Record<string, any> = {};

    applyRemoteAuthHeadersForWatcher(watcher as any, options as any);

    expect(options.headers).toEqual({
      Authorization: 'Bearer token-abc',
    });
  });

  test('applyRemoteAuthHeadersForWatcher initializes oidc state and applies cached token', () => {
    const oidcContext = { watcherName: 'watcher-a' };
    const watcher = createWatcher({
      remoteOidcAccessToken: 'cached-oidc-token',
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'oidc',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'oidc',
        hasBearer: false,
        hasBasic: false,
        hasOidcConfig: true,
      })),
      getOidcContext: vi.fn(() => oidcContext),
    });
    const options: Record<string, any> = {};

    applyRemoteAuthHeadersForWatcher(watcher as any, options as any);

    expect(mockInitializeRemoteOidcStateFromConfiguration).toHaveBeenCalledWith(oidcContext);
    expect(options.headers).toEqual({
      Authorization: 'Bearer cached-oidc-token',
    });
  });

  test('applyRemoteAuthHeadersForWatcher fails unsupported auth type after https check', () => {
    const watcher = createWatcher({
      configuration: {
        host: 'docker-api.example.com',
        socket: '/var/run/docker.sock',
        port: 443,
        auth: {
          bearer: 'token-1',
          type: 'digest',
        },
      },
      getRemoteAuthResolution: vi.fn(() => ({
        authType: 'digest',
        hasBearer: true,
        hasBasic: false,
        hasOidcConfig: false,
      })),
    });

    applyRemoteAuthHeadersForWatcher(watcher as any, {} as any);

    expect(watcher.handleRemoteAuthFailure).toHaveBeenCalledWith(
      'Unable to authenticate remote watcher watcher-a: auth type "digest" is unsupported',
    );
  });
});
