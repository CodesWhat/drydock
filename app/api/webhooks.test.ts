const { mockRouter, mockRegistryWebhookRouter, mockRegistryRouterInit } = vi.hoisted(() => {
  // An object, not a string sentinel: webhooks.ts mounts through mountRouter,
  // which records the mount path on the router it is handed.
  const registryWebhookRouter = { router: 'registry-webhook-router' };
  return {
    mockRouter: {
      use: vi.fn(),
    },
    mockRegistryWebhookRouter: registryWebhookRouter,
    mockRegistryRouterInit: vi.fn(() => registryWebhookRouter),
  };
});

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
    expect(mockRouter.use).toHaveBeenCalledWith('/registry', mockRegistryWebhookRouter);
  });
});
