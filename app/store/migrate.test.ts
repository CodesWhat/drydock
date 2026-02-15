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

test('migrate should delete all containers when from is lower than 8 and to is grater than 8', async () => {
  migrate.migrate('7.0.0', '8.0.0');
  expect(container.deleteContainer).toHaveBeenCalledTimes(2);
});

test('migrate should not delete all containers when from is from and to are 8 versions', async () => {
  migrate.migrate('8.1.0', '8.2.0');
  expect(container.deleteContainer).not.toHaveBeenCalled();
});
