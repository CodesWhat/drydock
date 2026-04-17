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

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limit-middleware'),
}));

vi.mock('../runtime/paths', () => ({
  resolveUiDirectory: vi.fn(() => '/app/ui'),
}));

import express from 'express';
import * as uiRouter from './ui.js';

describe('UI Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with static serving and catch-all', () => {
    const router = uiRouter.init();
    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalledWith('static-middleware');
    expect(express.static).toHaveBeenCalledWith(
      '/app/ui',
      expect.objectContaining({
        setHeaders: expect.any(Function),
      }),
    );
    expect(router.get).toHaveBeenCalledWith(
      '/{*path}',
      'rate-limit-middleware',
      expect.any(Function),
    );
  });

  test('should apply rate limiting only to SPA document fallback requests', () => {
    uiRouter.init();

    expect(mockRouter.use).not.toHaveBeenCalledWith('rate-limit-middleware');
    expect(mockRouter.get).toHaveBeenCalledWith(
      '/{*path}',
      'rate-limit-middleware',
      expect.any(Function),
    );
  });

  test('catch-all should send index.html', () => {
    uiRouter.init();
    const catchAllHandler = mockRouter.get.mock.calls.find((c) => c[0] === '/{*path}')[2];

    const res = { sendFile: vi.fn(), set: vi.fn() };
    catchAllHandler({}, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.sendFile).toHaveBeenCalledWith(expect.stringContaining('index.html'));
  });

  test('should disable caching for html documents served statically', () => {
    uiRouter.init();
    const setHeaders = vi.mocked(express.static).mock.calls[0][1]?.setHeaders;
    const res = { setHeader: vi.fn() };

    setHeaders?.(res as never, '/app/ui/index.html');

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  test('should mark hashed ui assets as immutable when served statically', () => {
    uiRouter.init();
    const setHeaders = vi.mocked(express.static).mock.calls[0][1]?.setHeaders;
    const res = { setHeader: vi.fn() };

    setHeaders?.(res as never, '/app/ui/assets/index-DqB0kGoJ.js');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
  });

  test('should leave cache headers untouched for non-html files outside assets', () => {
    uiRouter.init();
    const setHeaders = vi.mocked(express.static).mock.calls[0][1]?.setHeaders;
    const res = { setHeader: vi.fn() };

    setHeaders?.(res as never, '/app/ui/favicon.ico');

    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
