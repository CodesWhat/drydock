import { getSettingsSchemaKeys } from '../store/settings.js';
import { createMockResponse } from '../test/helpers.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';
import { SESSION_ONLY_MESSAGE } from './route-scopes.js';

const SEEDED_SECRET = 'sentinel-secret-value-should-never-leak';

const {
  mockRouter,
  mockGetServerConfiguration,
  mockGetConfigFileInfo,
  mockDdEnvVars,
  mockConfigFileSources,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockGetServerConfiguration: vi.fn(() => ({}) as Record<string, unknown>),
  mockGetConfigFileInfo: vi.fn(() => undefined as { path: string; modifiedAt: string } | undefined),
  mockDdEnvVars: {} as Record<string, string | undefined>,
  mockConfigFileSources: {} as Record<string, string>,
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('express-rate-limit', () => ({
  default: vi.fn((options: unknown) => ({ rateLimiter: options })),
}));

const mockRecordAuditEvent = vi.fn();
vi.mock('./audit-events.js', () => ({
  recordAuditEvent: (...args: any[]) => mockRecordAuditEvent(...args),
}));

// Partial mock: `openapi-contract.js` (imported below for the contract test)
// transitively imports this same module through `openapi.js`, and needs its
// other real exports (`getVersion`, etc). Only the three this router
// actually reads are overridden. `ddEnvVars`/`configFileSources` are shared,
// mutable objects (not reassigned per test) so `buildSections()`'s
// `Object.entries(ddEnvVars)` — read at request time, through the live
// binding — sees whatever a test populated in `beforeEach`.
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getServerConfiguration: () => mockGetServerConfiguration(),
    ddEnvVars: mockDdEnvVars,
    configFileSources: mockConfigFileSources,
  };
});

vi.mock('../configuration/file/layer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/file/layer.js')>();
  return {
    ...actual,
    getConfigFileInfo: () => mockGetConfigFileInfo(),
  };
});

import * as configRouter from './config.js';

function createResponse() {
  return createMockResponse();
}

function getHandler(path: string) {
  if (path === '/validate') {
    return mockRouter.post.mock.calls.find((call) => call[0] === path)?.at(-1);
  }
  return mockRouter.get.mock.calls.find((call) => call[0] === path)?.at(-1);
}

describe('Config Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerConfiguration.mockReturnValue({});
    mockGetConfigFileInfo.mockReturnValue(undefined);

    for (const key of Object.keys(mockDdEnvVars)) {
      delete mockDdEnvVars[key];
    }
    for (const key of Object.keys(mockConfigFileSources)) {
      delete mockConfigFileSources[key];
    }

    // A spread of sections, deliberately including some the original
    // five-name list never had (auth, store), a secret resolved through a
    // `_file` node in production (registry token), one single-segment key
    // (DD_VERSION) that names no section at all, a non-DD_-prefixed stray
    // key (defensive: real `ddEnvVars` never carries one, but the filter
    // exists precisely so it wouldn't be reported if it did), and a DD_ key
    // with an explicitly-undefined value (same "unset" convention `ddEnvVars`
    // uses everywhere else).
    Object.assign(mockDdEnvVars, {
      DD_SERVER_PORT: '3000',
      DD_WATCHER_LOCAL_SOCKET: '/var/run/docker.sock',
      DD_REGISTRY_GHCR_PRIVATE_USERNAME: 'scott',
      DD_REGISTRY_GHCR_PRIVATE_TOKEN: SEEDED_SECRET,
      DD_ACTION_DOCKER_LOCAL_PRUNE: 'true',
      DD_NOTIFICATION_SLACK_MYSLACK_CHANNEL: '#updates',
      DD_NOTIFICATION_SLACK_MYSLACK_TOKEN: SEEDED_SECRET,
      DD_AUTH_BASIC_JOHN_HASH: SEEDED_SECRET,
      DD_STORE_PATH: '/store/dd.json',
      DD_VERSION: '1.8.0',
      NOT_A_DD_VAR: 'ignored',
      DD_UNSET_KEY: undefined,
    });
    Object.assign(mockConfigFileSources, {
      DD_SERVER_PORT: 'env',
      DD_REGISTRY_GHCR_PRIVATE_TOKEN: 'file',
    });
  });

  test('registers nocache middleware and rate-limited, session-only GET routes', () => {
    const router = configRouter.init();
    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith(
      '/',
      { rateLimiter: expect.objectContaining({ windowMs: 60_000, max: 5 }) },
      expect.any(Function),
    );
    expect(router.get).toHaveBeenCalledWith(
      '/:section',
      { rateLimiter: expect.objectContaining({ windowMs: 60_000, max: 5 }) },
      expect.any(Function),
    );
    expect(router.post).toHaveBeenCalledWith(
      '/validate',
      { rateLimiter: expect.objectContaining({ windowMs: 60_000, max: 5 }) },
      expect.any(Function),
    );
  });

  test('POST /validate rejects an API key without admin scope', async () => {
    configRouter.init();
    const handler = getHandler('/validate');
    const res = createResponse();

    await handler({ principal: { kind: 'api-key', scopes: ['read'] }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('POST /validate is reachable by an API key holding admin', async () => {
    configRouter.init();
    const handler = getHandler('/validate');
    const res = createResponse();

    await handler({ principal: { kind: 'api-key', scopes: ['admin'] }, body: {} }, res);

    // Scope enforcement is what this test is about — an admin key reaches
    // the handler at all (200, not 403), whatever the seeded, deliberately
    // validation-hostile fixture data above (SEEDED_SECRET is not a real
    // argon2 hash) makes the actual `valid` verdict. config-validate.test.ts
    // exercises the validation outcomes themselves against a clean env.
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as any).mock.calls[0][0].valid).toEqual(expect.any(Boolean));
  });

  test('keys the rate limit by identity when identity keying is enabled', () => {
    mockGetServerConfiguration.mockReturnValue({ ratelimit: { identitykeying: true } });

    configRouter.init();

    const limiterOptions = mockRouter.get.mock.calls.find((call) => call[0] === '/')?.[1];
    expect(limiterOptions.rateLimiter.keyGenerator).toEqual(expect.any(Function));
  });

  test('GET / returns the effective configuration, derived from every DD_* prefix present', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toEqual({
      file: { present: false },
      sections: {
        server: { port: '3000' },
        watcher: { local: { socket: '/var/run/docker.sock' } },
        registry: { ghcr: { private: { username: 'scott', token: '[REDACTED]' } } },
        action: { docker: { local: { prune: 'true' } } },
        // `channel` is not a sensitive key name under the generic key-name
        // redactor (`app/debug/redact.ts`) the way it was under the
        // component-specific trigger-infrastructure redactor this router no
        // longer uses — every section is redacted the same way now, so
        // `channel` passes through unredacted here.
        notification: { slack: { myslack: { channel: '#updates', token: '[REDACTED]' } } },
        auth: { basic: { john: { hash: '[REDACTED]' } } },
        store: { path: '/store/dd.json' },
      },
      sources: {
        DD_SERVER_PORT: 'env',
        DD_REGISTRY_GHCR_PRIVATE_TOKEN: 'file',
      },
      restartRequired: [],
    });
  });

  test('a DD_* key with no segment past the section name is not reported as a section', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.sections.version).toBeUndefined();
  });

  test('GET / never contains the seeded secret anywhere in the response body', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain(SEEDED_SECRET);
  });

  test('GET / reports file.present true with path and modifiedAt when a file was loaded', async () => {
    mockGetConfigFileInfo.mockReturnValue({
      path: '/config/drydock.yml',
      modifiedAt: '2026-09-07T00:00:00.000Z',
    });

    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.file).toStrictEqual({
      present: true,
      path: '/config/drydock.yml',
      modifiedAt: '2026-09-07T00:00:00.000Z',
    });
  });

  test('records a config-read audit entry before the body is sent', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'config-read',
      containerName: 'diagnostics',
      status: 'info',
      details: 'Read the effective configuration',
    });
  });

  test('fails GET / with a 500 when building the response throws', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();
    mockGetConfigFileInfo.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to build the effective configuration' });
  });

  test('GET /:section returns a known section', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();

    await handler({ params: { section: 'watcher' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as any).mock.calls[0][0]).toStrictEqual({
      local: { socket: '/var/run/docker.sock' },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'config-read',
      containerName: 'diagnostics',
      status: 'info',
      details: 'Read the "watcher" configuration section',
    });
  });

  test('GET /:section returns a section beyond the original five, with redaction applied', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();

    await handler({ params: { section: 'auth' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as any).mock.calls[0][0]).toStrictEqual({
      basic: { john: { hash: '[REDACTED]' } },
    });
  });

  test('GET /:section 404s for an unknown section and records no audit entry', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();

    await handler({ params: { section: 'nope' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown configuration section' });
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  test('fails GET /:section with a 500 when building the response throws', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();
    mockGetConfigFileInfo.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await handler({ params: { section: 'server' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to build the effective configuration' });
  });

  test('GET / is denied to an API key, even one holding admin', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({ principal: { kind: 'api-key', scopes: ['admin'] } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: SESSION_ONLY_MESSAGE });
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  test('GET /:section is denied to an API key, even one holding admin', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();

    await handler(
      { params: { section: 'server' }, principal: { kind: 'api-key', scopes: ['admin'] } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: SESSION_ONLY_MESSAGE });
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  test('GET / response satisfies the OpenAPI contract', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const contractValidation = validateOpenApiJsonResponse({
      path: '/api/v1/config',
      method: 'get',
      statusCode: '200',
      payload: (res.json as any).mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });

  test('GET /:section response satisfies the OpenAPI contract', async () => {
    configRouter.init();
    const handler = getHandler('/:section');
    const res = createResponse();

    await handler({ params: { section: 'watcher' } }, res);

    const contractValidation = validateOpenApiJsonResponse({
      path: '/api/v1/config/{section}',
      method: 'get',
      statusCode: '200',
      payload: (res.json as any).mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });

  test('a key present in a section but absent from sources reports no source', async () => {
    // `mockConfigFileSources` (seeded in beforeEach) only tracks
    // DD_SERVER_PORT and DD_REGISTRY_GHCR_PRIVATE_TOKEN — standing in for
    // the two real cases where a section key can appear without a `sources`
    // entry: a Joi default (never in the merged env at all, so this generic
    // derivation wouldn't produce it either) and a `_file`-resolved secret
    // (`sources` still names the old `..._FILE` key, never the base key
    // `replaceSecrets` writes the resolved value under). Either way, this
    // never invents a third "default" source value — the section value
    // shows up, `sources` simply omits it.
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.sections.watcher).toStrictEqual({ local: { socket: '/var/run/docker.sock' } });
    expect(payload.sources.DD_WATCHER_LOCAL_SOCKET).toBeUndefined();
  });

  test('the reported section keys never intersect the settings store schema keys', async () => {
    configRouter.init();
    const handler = getHandler('/');
    const res = createResponse();

    await handler({}, res);

    const payload = (res.json as any).mock.calls[0][0];
    const configSectionKeys = new Set(Object.keys(payload.sections));
    for (const settingsKey of getSettingsSchemaKeys()) {
      expect(configSectionKeys.has(settingsKey)).toBe(false);
    }
  });
});
