import * as container from './container.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));
vi.mock('./container', () => ({
  getContainers: vi.fn(() => [{ name: 'container1' }, { name: 'container2' }]),
  deleteContainer: vi.fn(),
}));

import * as migrate from './migrate.js';

beforeEach(async () => {
  vi.clearAllMocks();
});

test('migrate should not delete containers for legacy 7.x to 8.x version bumps', async () => {
  migrate.migrate('7.0.0', '8.0.0');
  expect(container.deleteContainer).not.toHaveBeenCalled();
});

test('migrate should not delete containers when from and to are 8.x versions', async () => {
  migrate.migrate('8.1.0', '8.2.0');
  expect(container.deleteContainer).not.toHaveBeenCalled();
});
