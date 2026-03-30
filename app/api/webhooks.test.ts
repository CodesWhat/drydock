const { mockRouter, mockRegistryRouterInit } = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn(),
  },
  mockRegistryRouterInit: vi.fn(() => 'registry-webhook-router'),
}));

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => mockRouter),
  },
}));

vi.mock('./webhooks/registry.js', () => ({
  init: mockRegistryRouterInit,
}));

import * as webhooksRouter from './webhooks.js';

describe('api/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('mounts the registry webhook sub-router', () => {
    webhooksRouter.init();

    expect(mockRegistryRouterInit).toHaveBeenCalledTimes(1);
    expect(mockRouter.use).toHaveBeenCalledWith('/registry', 'registry-webhook-router');
  });
});
