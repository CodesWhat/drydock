import { readFileSync } from 'node:fs';
import { createMockResponse } from '../test/helpers.js';
import { openApiPaths } from './openapi/paths/index.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const { router, getStored, replaceStored, broadcast } = vi.hoisted(() => ({
  router: { use: vi.fn(), get: vi.fn(), patch: vi.fn() },
  getStored: vi.fn(),
  replaceStored: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('express', () => ({ default: { Router: vi.fn(() => router) } }));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache') }));
vi.mock('../store/ui-preferences', () => ({
  getPreferences: getStored,
  replacePreferences: replaceStored,
}));
vi.mock('./sse', () => ({ broadcastPreferencesUpdated: broadcast }));
vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
  },
}));

import * as preferencesRouter from './preferences.js';

const record = {
  username: 'alice',
  schemaVersion: 11,
  preferences: { sync: { enabled: true } },
  updatedAt: '2026-07-11T12:00:00.000Z',
};

function handler(method: 'get' | 'patch') {
  preferencesRouter.init();
  return router[method].mock.calls.find((call) => call[0] === '/')![1];
}

function assertContract(method: 'get' | 'patch', res: any) {
  const result = validateOpenApiJsonResponse({
    path: '/api/v1/preferences',
    method,
    statusCode: '200',
    payload: res.json.mock.calls[0][0],
  });
  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
}

describe('preferences router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStored.mockReturnValue(record);
    replaceStored.mockReturnValue(record);
  });

  it('initializes middleware and routes', () => {
    expect(preferencesRouter.init()).toBe(router);
    expect(router.use).toHaveBeenCalledWith('nocache');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.patch).toHaveBeenCalledWith('/', expect.any(Function));
  });

  it('gets an existing user record in an OpenAPI-valid envelope', () => {
    const res = createMockResponse();
    handler('get')({ user: { username: ' alice ' } }, res);
    expect(getStored).toHaveBeenCalledWith('alice');
    expect(res.json).toHaveBeenCalledWith({ apiVersion: 1, ...record });
    assertContract('get', res);
  });

  it('returns nullable fields when no record exists', () => {
    getStored.mockReturnValue(null);
    const res = createMockResponse();
    handler('get')({ user: { username: 'alice' } }, res);
    expect(res.json).toHaveBeenCalledWith({
      apiVersion: 1,
      username: 'alice',
      schemaVersion: null,
      preferences: null,
      updatedAt: null,
    });
    assertContract('get', res);
  });

  it.each([
    undefined,
    { username: 'anonymous' },
    { username: '   ' },
  ])('rejects anonymous GET before store access', (user) => {
    const res = createMockResponse();
    handler('get')({ user }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(getStored).not.toHaveBeenCalled();
  });

  it('replaces preferences, broadcasts, and returns an OpenAPI-valid response', () => {
    const res = createMockResponse();
    const body = { apiVersion: 1, schemaVersion: 11, preferences: record.preferences };
    handler('patch')({ user: { username: 'alice' }, body }, res);
    expect(replaceStored).toHaveBeenCalledWith('alice', 11, record.preferences);
    expect(broadcast).toHaveBeenCalledWith();
    expect(res.status).toHaveBeenCalledWith(200);
    assertContract('patch', res);
  });

  it('accepts unknown keys inside the opaque preferences blob', () => {
    const res = createMockResponse();
    const preferences = { futureFeature: { value: true } };
    handler('patch')(
      { user: { username: 'alice' }, body: { apiVersion: 1, schemaVersion: 99, preferences } },
      res,
    );
    expect(replaceStored).toHaveBeenCalledWith('alice', 99, preferences);
  });

  it('returns 409 for an API version mismatch without writing or broadcasting', () => {
    const res = createMockResponse();
    handler('patch')({ user: { username: 'alice' }, body: { apiVersion: 2 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'PREFERENCES_API_VERSION_MISMATCH',
      supportedApiVersion: 1,
    });
    expect(replaceStored).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { apiVersion: 1, schemaVersion: 11 },
  ])('returns 400 for malformed payload %#', (body) => {
    const res = createMockResponse();
    handler('patch')({ user: { username: 'alice' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(body?.apiVersion === undefined ? 409 : 400);
    if (body?.apiVersion !== undefined) {
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request parameters' });
    }
    expect(replaceStored).not.toHaveBeenCalled();
  });

  it('normalizes a falsy request body before Joi validation', () => {
    Object.defineProperty(Number.prototype, 'apiVersion', {
      configurable: true,
      get: () => 1,
    });
    try {
      const res = createMockResponse();
      handler('patch')({ user: { username: 'alice' }, body: 0 }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request parameters' });
    } finally {
      delete (Number.prototype as number & { apiVersion?: number }).apiVersion;
    }
  });

  it('rejects anonymous PATCH before validating', () => {
    const res = createMockResponse();
    handler('patch')({ user: undefined, body: { apiVersion: 2 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(replaceStored).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('keeps server, client, and OpenAPI preference API versions in lockstep', () => {
    const clientSource = readFileSync(
      new URL('../../ui/src/preferences/index.ts', import.meta.url),
      'utf8',
    );
    const clientVersion = Number(clientSource.match(/PREFERENCES_API_VERSION\s*=\s*(\d+)/)?.[1]);
    const patch = openApiPaths['/api/v1/preferences'].patch;
    const requestSchema = patch.requestBody.content['application/json'].schema;
    const openApiVersion = requestSchema.properties.apiVersion.enum[0];

    expect(preferencesRouter.PREFERENCES_API_VERSION).toBe(1);
    expect(clientVersion).toBe(preferencesRouter.PREFERENCES_API_VERSION);
    expect(openApiVersion).toBe(preferencesRouter.PREFERENCES_API_VERSION);
  });
});
