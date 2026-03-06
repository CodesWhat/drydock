vi.mock('./component', () => ({
  init: vi.fn(() => 'authentication-router'),
}));

import * as authenticationRouter from './authentication.js';
import * as component from './component.js';

describe('Authentication Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should init component router with authentication kind', () => {
    const router = authenticationRouter.init();
    expect(component.init).toHaveBeenCalledWith('authentication');
    expect(router).toBe('authentication-router');
  });
});
