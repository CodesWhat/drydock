const mockLogInfo = vi.hoisted(() => vi.fn());

import * as container from './container.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: mockLogInfo })) } }));
vi.mock('./container', () => ({
  getContainersRaw: vi.fn(() => []),
  updateContainer: vi.fn(),
  deleteContainer: vi.fn(),
}));

import * as migrate from './migrate.js';

beforeEach(async () => {
  vi.clearAllMocks();
});

test('migrate should not delete containers for legacy 7.x to 8.x version bumps', async () => {
  migrate.migrate('7.0.0', '8.0.0');
  expect(container.deleteContainer).not.toHaveBeenCalled();
  expect(mockLogInfo).toHaveBeenCalledWith('Migrate data between schema versions');
});

test('migrate should not delete containers when from and to are 8.x versions', async () => {
  migrate.migrate('8.1.0', '8.2.0');
  expect(container.deleteContainer).not.toHaveBeenCalled();
  expect(mockLogInfo).toHaveBeenCalledWith('Migrate data between schema versions');
});

test('migrate should backfill missing image.tag.tagPrecision for existing containers', async () => {
  container.getContainersRaw.mockReturnValue([
    {
      id: 'specific-release',
      transformTags: '^v(.*) => $1',
      image: {
        tag: {
          value: 'v1.2.3',
          semver: true,
        },
      },
    },
    {
      id: 'floating-release',
      image: {
        tag: {
          value: 'latest',
          semver: false,
        },
      },
    },
    {
      id: 'already-classified',
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
          tagPrecision: 'specific',
        },
      },
    },
  ]);

  migrate.migrate('1.5.0-rc.5', '1.5.0');

  expect(container.updateContainer).toHaveBeenCalledTimes(2);
  expect(container.updateContainer).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      id: 'specific-release',
      image: expect.objectContaining({
        tag: expect.objectContaining({
          value: 'v1.2.3',
          tagPrecision: 'specific',
        }),
      }),
    }),
  );
  expect(container.updateContainer).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      id: 'floating-release',
      image: expect.objectContaining({
        tag: expect.objectContaining({
          value: 'latest',
          tagPrecision: 'floating',
        }),
      }),
    }),
  );
});
