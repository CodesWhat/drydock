// Mock express modules
vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

vi.mock('nocache', () => ({ default: vi.fn() }));

import * as healthRouter from './health.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

// Test the initial module state (before any resetAuthReadyFnForTests call)
// to ensure the module-level default () => true initializer is covered.
describe('Health Router — initial module state', () => {
  test('healthHandler should return 200 by default (module initializer)', () => {
    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uptime: expect.any(Number) });

    const contractValidation = validateOpenApiJsonResponse({
      path: '/health',
      method: 'get',
      statusCode: '200',
      payload: res.json.mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });
});

describe('Health Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    healthRouter.resetAuthReadyFnForTests();
  });

  test('init() should return a router', () => {
    const router = healthRouter.init();
    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalled();
  });

  test('init() should register GET / with healthHandler', () => {
    const router = healthRouter.init();
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('healthHandler should return 200 with uptime when auth is ready (default)', () => {
    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    // Capture the handler registered with router.get
    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uptime: expect.any(Number) });
  });

  test('healthHandler should return 503 when auth is not ready', () => {
    healthRouter.setAuthReadyFn(() => false);

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'starting',
      reason: 'auth strategies not yet registered',
    });

    const contractValidation = validateOpenApiJsonResponse({
      path: '/health',
      method: 'get',
      statusCode: '503',
      payload: res.json.mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });

  test('healthHandler should return 200 when auth is ready via setAuthReadyFn', () => {
    healthRouter.setAuthReadyFn(() => true);

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uptime: expect.any(Number) });
  });

  test('setAuthReadyFn() should replace the readiness check', () => {
    const customFn = vi.fn(() => false);
    healthRouter.setAuthReadyFn(customFn);

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(customFn).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('resetAuthReadyFnForTests() should restore the default ready state', () => {
    healthRouter.setAuthReadyFn(() => false);
    healthRouter.resetAuthReadyFnForTests();

    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const router = healthRouter.init();
    const [, handler] = router.get.mock.calls[0];
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
