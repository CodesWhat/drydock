const { mockRouter } = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => mockRouter),
    static: vi.fn(() => 'static-middleware'),
  },
}));

vi.mock('../runtime/paths', () => ({
  resolveUiDirectory: vi.fn(() => '/app/ui'),
}));

import * as uiRouter from './ui.js';

describe('UI Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with static serving and catch-all', () => {
    const router = uiRouter.init();
    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalledWith('static-middleware');
    expect(router.get).toHaveBeenCalledWith('/{*path}', expect.any(Function));
  });

  test('catch-all should send index.html', () => {
    uiRouter.init();
    const catchAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/{*path}')[1];

    const res = { sendFile: vi.fn() };
    catchAllHandler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(expect.stringContaining('index.html'));
  });
});
