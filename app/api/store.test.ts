import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store', () => ({
  getConfiguration: vi.fn(() => ({
    path: '/test/store',
    file: 'db.json',
    dbFile: 'db.sqlite',
  })),
}));

import * as store from '../store/index.js';
import * as storeRouter from './store.js';

function createResponse() {
  return createMockResponse();
}

describe('Store Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and route', () => {
    const router = storeRouter.init();
    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should return store configuration', () => {
    storeRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(store.getConfiguration).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      configuration: {
        path: '/test/store',
        file: 'db.json',
        dbFile: 'db.sqlite',
      },
    });
  });

  // `dbFile` (roadmap 7-STORE, slice 2) is additive: `file` and `path` keep
  // meaning exactly what they mean today, and the frozen `/api/v1` response
  // shape gains a field rather than changing one (spec section 6, slice 2).
  test('should surface dbFile alongside the unchanged path and file fields', () => {
    storeRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    const [responseBody] = res.json.mock.calls[0];
    expect(responseBody.configuration).toMatchObject({
      path: '/test/store',
      file: 'db.json',
      dbFile: 'db.sqlite',
    });
  });
});
