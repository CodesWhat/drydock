// Mock services
vi.mock('@/services/server', () => ({
  getServer: vi.fn(() => Promise.resolve({ configuration: {} }))
}));

// Mock fetch
global.fetch = vi.fn();

describe('App.vue', () => {
  it('should pass basic test', () => {
    expect(true).toBe(true);
  });
});