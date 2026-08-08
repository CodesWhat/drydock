import { createMockRequest, createMockResponse } from '../test/helpers.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const { mockRouter, mockGetContainer, mockGetContainers } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockGetContainers: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
}));

import * as containerDependenciesRouter from './container-dependencies.js';

function getHandler(method: 'get' | 'post', path: string) {
  containerDependenciesRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call?.[1];
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    displayName: overrides.name,
    watcher: 'local',
    ...overrides,
  };
}

describe('Container Dependencies Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('registers GET /dependencies and POST /:id/update-chain-preview', () => {
      containerDependenciesRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/dependencies', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/:id/update-chain-preview',
        expect.any(Function),
      );
    });
  });

  describe('GET /dependencies', () => {
    test('returns the full resolved graph with node metadata and cycle detection', () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
      mockGetContainers.mockReturnValue([db, api]);

      const handler = getHandler('get', '/dependencies');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'db', name: 'db', displayName: 'db', watcher: 'local' }),
          expect.objectContaining({ id: 'api', name: 'api', displayName: 'api' }),
        ]),
      );
      expect(payload.edges).toEqual([
        expect.objectContaining({ from: 'api', to: 'db', action: 'update', source: 'label' }),
      ]);
      expect(payload.cycles).toEqual([]);
      expect(payload.unresolved).toEqual([]);
      expect(payload.crossHostIgnored).toEqual([]);

      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/v1/containers/dependencies',
        method: 'get',
        statusCode: '200',
        payload,
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('reports an unresolved dependsOn target and a detected cycle', () => {
      const a = makeContainer({ id: 'a', name: 'a', dependsOn: ['b'] });
      const b = makeContainer({ id: 'b', name: 'b', dependsOn: ['a'] });
      const ghost = makeContainer({ id: 'ghost', name: 'ghost', dependsOn: ['missing'] });
      mockGetContainers.mockReturnValue([a, b, ghost]);

      const handler = getHandler('get', '/dependencies');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.unresolved).toEqual([{ nodeId: 'ghost', missingTarget: 'missing' }]);
      expect(payload.cycles).toEqual([['a', 'b']]);
    });

    test('falls back to the node name for displayName when the container has none set', () => {
      const noDisplayName = { id: 'orphan', name: 'orphan', watcher: 'local' };
      mockGetContainers.mockReturnValue([noDisplayName]);

      const handler = getHandler('get', '/dependencies');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.nodes[0]).toEqual(
        expect.objectContaining({ id: 'orphan', displayName: 'orphan' }),
      );
    });
  });

  describe('POST /:id/update-chain-preview', () => {
    test('returns 404 when the container does not exist', () => {
      mockGetContainer.mockReturnValue(undefined);
      const handler = getHandler('post', '/:id/update-chain-preview');
      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('returns the ordered wave list for the requested container dependency chain, excluding unrelated containers', () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
      const proxy = makeContainer({
        id: 'proxy',
        name: 'proxy',
        dependsOn: ['api'],
        dependsOnAction: 'restart',
      });
      const unrelated = makeContainer({ id: 'redis', name: 'redis' });
      mockGetContainer.mockReturnValue(db);
      mockGetContainers.mockReturnValue([db, api, proxy, unrelated]);

      const handler = getHandler('post', '/:id/update-chain-preview');
      const req = createMockRequest({ params: { id: 'db' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.waves).toEqual([
        { index: 0, containers: [{ id: 'db', name: 'db', actionKind: 'update' }] },
        { index: 1, containers: [{ id: 'api', name: 'api', actionKind: 'update' }] },
        { index: 2, containers: [{ id: 'proxy', name: 'proxy', actionKind: 'restart' }] },
      ]);
      expect(payload.warnings).toEqual({ cycles: [], unresolved: [] });

      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/v1/containers/{id}/update-chain-preview',
        method: 'post',
        statusCode: '200',
        payload,
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('scopes the preview to the connected component when previewing from a mid-chain container', () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
      const unrelated = makeContainer({ id: 'redis', name: 'redis' });
      mockGetContainer.mockReturnValue(api);
      mockGetContainers.mockReturnValue([db, api, unrelated]);

      const handler = getHandler('post', '/:id/update-chain-preview');
      const req = createMockRequest({ params: { id: 'api' } });
      const res = createMockResponse();
      handler(req, res);

      const payload = res.json.mock.calls[0][0];
      const allIds = payload.waves.flatMap((wave: { containers: { id: string }[] }) =>
        wave.containers.map((c) => c.id),
      );
      expect(allIds.sort()).toEqual(['api', 'db']);
    });

    test('reports cycles and unresolved targets scoped to the chain in warnings', () => {
      const a = makeContainer({ id: 'a', name: 'a', dependsOn: ['b', 'missing'] });
      const b = makeContainer({ id: 'b', name: 'b', dependsOn: ['a'] });
      mockGetContainer.mockReturnValue(a);
      mockGetContainers.mockReturnValue([a, b]);

      const handler = getHandler('post', '/:id/update-chain-preview');
      const req = createMockRequest({ params: { id: 'a' } });
      const res = createMockResponse();
      handler(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.warnings.cycles).toEqual([['a', 'b']]);
      expect(payload.warnings.unresolved).toEqual([{ nodeId: 'a', missingTarget: 'missing' }]);
    });
  });
});
