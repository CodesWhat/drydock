vi.mock('./component', () => ({
  init: vi.fn(() => 'registry-router'),
}));

import * as component from './component.js';
import * as registryRouter from './registry.js';

describe('Registry Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should init component router with registry kind', () => {
    const router = registryRouter.init();
    expect(component.init).toHaveBeenCalledWith('registry');
    expect(router).toBe('registry-router');
  });
});
