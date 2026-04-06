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

  migrate.migrate('1.4.9', '1.5.0');

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

test('repairDataOnStartup should backfill missing image.tag.tagPrecision for existing containers', () => {
  container.getContainersRaw.mockReturnValue([
    {
      id: 'startup-repair',
      image: {
        tag: {
          value: 'latest',
          semver: false,
        },
      },
    },
  ]);

  migrate.repairDataOnStartup();

  expect(container.getContainersRaw).toHaveBeenCalledTimes(1);
  expect(container.updateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'startup-repair',
      image: expect.objectContaining({
        tag: expect.objectContaining({
          value: 'latest',
          tagPrecision: 'floating',
        }),
      }),
    }),
  );
});

test('migrate should skip tagPrecision backfill when target version is below 1.5.0', () => {
  migrate.migrate('1.4.0', '1.4.9');
  expect(container.getContainersRaw).not.toHaveBeenCalled();
});

test('migrate should skip tagPrecision backfill when from version is not a string', () => {
  migrate.migrate(undefined, '1.5.0');
  expect(container.getContainersRaw).not.toHaveBeenCalled();
});

test('migrate should backfill tagPrecision when from version is not a valid semver', () => {
  container.getContainersRaw.mockReturnValue([
    {
      id: 'invalid-from-version',
      image: {
        tag: {
          value: 'latest',
          semver: false,
        },
      },
    },
  ]);

  migrate.migrate('not-a-semver', '1.5.0');

  expect(container.getContainersRaw).toHaveBeenCalledTimes(1);
  expect(container.updateContainer).toHaveBeenCalledTimes(1);
  expect(container.updateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'invalid-from-version',
      image: expect.objectContaining({
        tag: expect.objectContaining({
          value: 'latest',
          tagPrecision: 'floating',
        }),
      }),
    }),
  );
});

test('migrate should skip tagPrecision backfill after crossing version 1.5.0', async () => {
  container.getContainersRaw.mockReturnValue([
    {
      id: 'already-past-migration',
      image: {
        tag: {
          value: '1.2.3',
          semver: true,
        },
      },
    },
  ]);

  migrate.migrate('1.5.0', '1.5.1');

  expect(container.getContainersRaw).not.toHaveBeenCalled();
  expect(container.updateContainer).not.toHaveBeenCalled();
});
