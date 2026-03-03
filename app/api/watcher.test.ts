vi.mock('./component', () => ({
  init: vi.fn(() => 'watcher-router'),
}));

import * as component from './component.js';
import * as watcherRouter from './watcher.js';

describe('Watcher Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should init component router with watcher kind', () => {
    const router = watcherRouter.init();
    expect(component.init).toHaveBeenCalledWith('watcher');
    expect(router).toBe('watcher-router');
  });
});
