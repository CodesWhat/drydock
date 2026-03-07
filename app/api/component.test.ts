import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('sort-es', () => ({
  byValues: vi.fn((fns) => (a, b) => {
    for (const [getter, comparator] of fns) {
      const result = comparator(getter(a), getter(b));
      if (result !== 0) return result;
    }
    return 0;
  }),
  byString: vi.fn(() => (a, b) => a.localeCompare(b)),
}));

vi.mock('../registry', () => ({
  getState: vi.fn(() => ({
    watcher: {},
    trigger: {},
  })),
}));

import * as registry from '../registry/index.js';
import * as component from './component.js';

function createResponse() {
  return createMockResponse();
}

describe('Component Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapComponentToItem', () => {
    test('should map a component to an API item', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({ url: 'https://hub.docker.com' })),
        agent: undefined,
      };
      const result = component.mapComponentToItem('docker.hub', comp);
      expect(result).toEqual({
        id: 'docker.hub',
        type: 'docker',
        name: 'hub',
        configuration: { url: 'https://hub.docker.com' },
        agent: undefined,
      });
    });

    test('should include agent field when present', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({})),
        agent: 'remote-agent',
      };
      const result = component.mapComponentToItem('remote-agent.docker.hub', comp);
      expect(result.agent).toBe('remote-agent');
    });

    test('should fallback to raw configuration when maskConfiguration is unavailable', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        configuration: { url: 'https://hub.docker.com' },
      };
      const result = component.mapComponentToItem('docker.hub', comp);
      expect(result).toEqual(
        expect.objectContaining({
          configuration: { url: 'https://hub.docker.com' },
        }),
      );
    });
  });

  describe('mapComponentsToList', () => {
    test('should map and sort components', () => {
      const components = {
        'docker.beta': {
          type: 'docker',
          name: 'beta',
          maskConfiguration: vi.fn(() => ({})),
        },
        'acr.alpha': {
          type: 'acr',
          name: 'alpha',
          maskConfiguration: vi.fn(() => ({})),
        },
      };
      const result = component.mapComponentsToList(components);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('acr');
      expect(result[1].type).toBe('docker');
    });

    test('should return empty array for empty components', () => {
      const result = component.mapComponentsToList({});
      expect(result).toEqual([]);
    });

    test('should sort by name when type is identical', () => {
      const components = {
        'docker.zeta': {
          type: 'docker',
          name: 'zeta',
          maskConfiguration: vi.fn(() => ({})),
        },
        'docker.alpha': {
          type: 'docker',
          name: 'alpha',
          maskConfiguration: vi.fn(() => ({})),
        },
      };

      const result = component.mapComponentsToList(components);

      expect(result[0].name).toBe('alpha');
      expect(result[1].name).toBe('zeta');
    });
  });

  describe('getById', () => {
    test('should return component by type.name id', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({ url: 'hub' })),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.hub': comp },
      });

      const req = { params: { type: 'docker', name: 'hub' } };
      const res = createResponse();
      component.getById(req, res, 'watcher');

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'docker.hub' }));
    });

    test('should return component by agent.type.name id', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({})),
        agent: 'myagent',
      };
      registry.getState.mockReturnValue({
        watcher: { 'myagent.docker.hub': comp },
      });

      const req = {
        params: { agent: 'myagent', type: 'docker', name: 'hub' },
      };
      const res = createResponse();
      component.getById(req, res, 'watcher');

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'myagent.docker.hub' }));
    });

    test('should return 404 when component is not found', () => {
      registry.getState.mockReturnValue({ watcher: {} });

      const req = { params: { type: 'docker', name: 'missing' } };
      const res = createResponse();
      component.getById(req, res, 'watcher');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Component not found' }),
      );
    });
  });

  describe('init', () => {
    test('should create router with nocache and routes', () => {
      const router = component.init('watcher');

      expect(router.use).toHaveBeenCalledWith('nocache-middleware');
      expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:type/:name', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:type/:name/:agent', expect.any(Function));
    });

    test('getAll handler should return list of components', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({})),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.hub': comp },
      });

      component.init('watcher');
      const getAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

      const res = createResponse();
      getAllHandler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'docker.hub' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('getAll handler should apply limit/offset pagination', () => {
      registry.getState.mockReturnValue({
        watcher: {
          'docker.beta': { type: 'docker', name: 'beta', maskConfiguration: vi.fn(() => ({})) },
          'acr.alpha': { type: 'acr', name: 'alpha', maskConfiguration: vi.fn(() => ({})) },
          'docker.gamma': { type: 'docker', name: 'gamma', maskConfiguration: vi.fn(() => ({})) },
        },
      });

      component.init('watcher');
      const getAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

      const res = createResponse();
      getAllHandler({ query: { limit: '1', offset: '1' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'docker.beta' })],
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
      });
    });

    test('getAll handler should normalize invalid pagination params', () => {
      registry.getState.mockReturnValue({
        watcher: {
          'docker.alpha': { type: 'docker', name: 'alpha', maskConfiguration: vi.fn(() => ({})) },
          'docker.beta': { type: 'docker', name: 'beta', maskConfiguration: vi.fn(() => ({})) },
          'docker.gamma': { type: 'docker', name: 'gamma', maskConfiguration: vi.fn(() => ({})) },
        },
      });

      component.init('watcher');
      const getAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

      const res = createResponse();
      getAllHandler({ query: { limit: ['999', '1'], offset: '-5' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ id: 'docker.alpha' }),
          expect.objectContaining({ id: 'docker.beta' }),
          expect.objectContaining({ id: 'docker.gamma' }),
        ],
        total: 3,
        limit: 200,
        offset: 0,
        hasMore: false,
      });
    });

    test('getAll handler should return an empty page when offset exceeds available components', () => {
      registry.getState.mockReturnValue({
        watcher: {
          'docker.alpha': { type: 'docker', name: 'alpha', maskConfiguration: vi.fn(() => ({})) },
          'docker.beta': { type: 'docker', name: 'beta', maskConfiguration: vi.fn(() => ({})) },
        },
      });

      component.init('watcher');
      const getAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

      const res = createResponse();
      getAllHandler({ query: { limit: '1', offset: '99' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [],
        total: 2,
        limit: 1,
        offset: 99,
        hasMore: false,
      });
    });

    test('getAll handler should fallback when pagination values are non-numeric or query is missing', () => {
      registry.getState.mockReturnValue({
        watcher: {
          'docker.alpha': { type: 'docker', name: 'alpha', maskConfiguration: vi.fn(() => ({})) },
        },
      });

      component.init('watcher');
      const getAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const resWithInvalid = createResponse();
      const resWithUndefinedQuery = createResponse();

      getAllHandler({ query: { limit: 'oops', offset: 'oops' } }, resWithInvalid);
      getAllHandler({}, resWithUndefinedQuery);

      expect(resWithInvalid.status).toHaveBeenCalledWith(200);
      expect(resWithInvalid.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'docker.alpha' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
      expect(resWithUndefinedQuery.status).toHaveBeenCalledWith(200);
      expect(resWithUndefinedQuery.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'docker.alpha' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('getById handler via /:type/:name should work', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({})),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.hub': comp },
      });

      component.init('trigger');
      const getByIdHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/:type/:name')[1];

      const res = createResponse();
      getByIdHandler({ params: { type: 'docker', name: 'hub' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('getById handler via /:type/:name/:agent should work', () => {
      const comp = {
        type: 'docker',
        name: 'hub',
        maskConfiguration: vi.fn(() => ({})),
        agent: 'myagent',
      };
      registry.getState.mockReturnValue({
        trigger: { 'myagent.docker.hub': comp },
      });

      component.init('trigger');
      const getByIdHandler = mockRouter.get.mock.calls.find(
        (c) => c[0] === '/:type/:name/:agent',
      )[1];

      const res = createResponse();
      getByIdHandler({ params: { agent: 'myagent', type: 'docker', name: 'hub' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
