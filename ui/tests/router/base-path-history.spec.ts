const baseHistoryMocks = vi.hoisted(() => ({
  createWebHistory: vi.fn(() => ({ kind: 'history' })),
}));

vi.mock('vue-router', () => ({
  createRouter: vi.fn(() => ({ beforeEach: vi.fn(), onError: vi.fn(), afterEach: vi.fn() })),
  createWebHistory: baseHistoryMocks.createWebHistory,
}));
vi.mock('@/services/auth', () => ({ getUser: vi.fn(), acknowledgeApiKeyReview: vi.fn() }));
vi.mock('@/preferences/sync', () => ({
  hydrateFromServer: vi.fn(),
  syncAuthenticatedUser: vi.fn(),
}));
vi.mock('@/bootstrap/stale-chunk-recovery', () => ({
  requestStaleChunkReload: vi.fn(),
  clearStaleChunkReloadGuard: vi.fn(),
}));

describe('router history under a sub-path', () => {
  afterEach(() => {
    document.head.querySelector('meta[name="dd-base-path"]')?.remove();
  });

  it('roots the history at the published base path', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'dd-base-path');
    meta.setAttribute('content', '/drydock');
    document.head.appendChild(meta);
    vi.resetModules();
    await import('@/router');
    expect(baseHistoryMocks.createWebHistory).toHaveBeenCalledWith('/drydock/');
  });
});
