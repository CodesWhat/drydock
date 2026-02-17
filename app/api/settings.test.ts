import { createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), put: vi.fn() },
  mockGetSettings: vi.fn(() => ({ internetlessMode: false })),
  mockUpdateSettings: vi.fn((settings) => ({ internetlessMode: settings.internetlessMode })),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/settings', () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
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
  });

  test('should update settings when payload is valid', () => {
    settingsRouter.init();
    const handler = mockRouter.put.mock.calls.find((call) => call[0] === '/')[1];
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
  });

  test('should reject invalid settings payload', () => {
    settingsRouter.init();
    const handler = mockRouter.put.mock.calls.find((call) => call[0] === '/')[1];
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
      error: expect.any(String),
    });
  });

  test('should reject empty settings payload', () => {
    settingsRouter.init();
    const handler = mockRouter.put.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({ body: undefined }, res);

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.any(String),
    });
  });
});
