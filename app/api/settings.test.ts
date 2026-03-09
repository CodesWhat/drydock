import { createMockResponse } from '../test/helpers.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const deprecatedPutDeprecation = '@1798761600';
const deprecatedPutSunset = 'Wed, 01 Jan 2027 00:00:00 GMT';

const { mockRouter, mockGetSettings, mockUpdateSettings, mockLogWarn } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn() },
  mockGetSettings: vi.fn(() => ({ internetlessMode: false })),
  mockUpdateSettings: vi.fn((settings) => ({ internetlessMode: settings.internetlessMode })),
  mockLogWarn: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/settings', () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: mockLogWarn, debug: vi.fn(), error: vi.fn() })),
  },
}));

import * as settingsRouter from './settings.js';

describe('Settings Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and routes', () => {
    const router = settingsRouter.init();

    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.patch).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.put).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should return settings', () => {
    settingsRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({}, res);

    expect(mockGetSettings).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      internetlessMode: false,
    });
    const contractValidation = validateOpenApiJsonResponse({
      path: '/api/settings',
      method: 'get',
      statusCode: '200',
      payload: res.json.mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });

  test('should update settings when payload is valid', () => {
    settingsRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler(
      {
        body: {
          internetlessMode: true,
        },
      },
      res,
    );

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      internetlessMode: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      internetlessMode: true,
    });
    const contractValidation = validateOpenApiJsonResponse({
      path: '/api/settings',
      method: 'patch',
      statusCode: '200',
      payload: res.json.mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });

  test('should reject invalid settings payload', () => {
    settingsRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler(
      {
        body: {
          internetlessMode: 'yes',
        },
      },
      res,
    );

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid request parameters',
    });
  });

  test('should reject empty settings payload', () => {
    settingsRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({ body: undefined }, res);

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid request parameters',
    });
  });

  test('should keep PUT route as a compatibility alias and return deprecation headers', () => {
    settingsRouter.init();
    const handler = mockRouter.put.mock.calls.find((call) => call[0] === '/')[1];
    const res = {
      ...createMockResponse(),
      setHeader: vi.fn(),
    };

    handler(
      {
        body: {
          internetlessMode: true,
        },
      },
      res,
    );

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      internetlessMode: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      internetlessMode: true,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', deprecatedPutDeprecation);
    expect(res.setHeader).toHaveBeenCalledWith('Sunset', deprecatedPutSunset);
    expect(mockLogWarn).toHaveBeenCalledWith(
      'PUT /api/settings is deprecated and will be removed in v1.6.0. Use PATCH /api/settings instead.',
    );
  });

  test('should not return deprecation headers on PATCH', () => {
    settingsRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/')[1];
    const res = {
      ...createMockResponse(),
      setHeader: vi.fn(),
    };

    handler(
      {
        body: {
          internetlessMode: true,
        },
      },
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).not.toHaveBeenCalledWith('Deprecation', deprecatedPutDeprecation);
    expect(res.setHeader).not.toHaveBeenCalledWith('Sunset', deprecatedPutSunset);
  });
});
