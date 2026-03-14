import { installJsonPathMock } from '@/views/storybookFetchMock';

describe('installJsonPathMock', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns mocked json payload for the configured path', async () => {
    installJsonPathMock('/api/registries', [{ id: 'reg-1' }]);

    const response = await globalThis.fetch('/api/registries');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: 'reg-1' }]);
  });

  it('returns a 404 for unmatched paths', async () => {
    installJsonPathMock('/api/registries', []);

    const response = await globalThis.fetch('/api/not-found');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'No mock for /api/not-found',
    });
  });

  it('supports URL inputs', async () => {
    installJsonPathMock('/api/registries', [{ id: 'reg-1' }]);

    const response = await globalThis.fetch(new URL('http://localhost/api/registries'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: 'reg-1' }]);
  });

  it('supports Request inputs', async () => {
    installJsonPathMock('/api/registries', [{ id: 'reg-1' }]);

    const response = await globalThis.fetch(new Request('http://localhost/api/registries'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: 'reg-1' }]);
  });
});
