const mockLogInfo = vi.hoisted(() => vi.fn());

import * as container from './container.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: mockLogInfo })) } }));
vi.mock('./container', () => ({
  getContainersRaw: vi.fn(() => []),
  cloneContainer: vi.fn((container) => structuredClone(container)),
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

describe('trigger label category re-derivation (#494)', () => {
  test('re-derives the scoped fields for containers that only carry the deprecated mirror', () => {
    container.getContainersRaw.mockReturnValue([
      {
        id: 'legacy-mirror',
        labels: { 'dd.action.include': 'docker', 'dd.notification.include': 'slack' },
        triggerInclude: 'docker',
      },
    ]);

    migrate.migrate('1.5.1', '1.6.0');

    // updateContainer() re-runs the label-driven normalization, which recovers the
    // notification value the collapsed first-match mirror discarded.
    expect(container.updateContainer).toHaveBeenCalledTimes(1);
    expect(container.updateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-mirror', triggerInclude: 'docker' }),
    );
  });

  test.each([
    'actionTriggerInclude',
    'actionTriggerExclude',
    'notificationTriggerInclude',
    'notificationTriggerExclude',
  ])('leaves a container that already has %s untouched', (field) => {
    container.getContainersRaw.mockReturnValue([
      { id: 'already-scoped', triggerInclude: 'docker', [field]: 'docker' },
    ]);

    migrate.migrate('1.5.1', '1.6.0');

    expect(container.updateContainer).not.toHaveBeenCalled();
  });

  test('re-derives a container with no trigger fields at all', () => {
    container.getContainersRaw.mockReturnValue([{ id: 'no-triggers' }]);

    migrate.migrate('1.5.1', '1.6.0');

    expect(container.updateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'no-triggers' }),
    );
  });

  test('does not run when the target version is below 1.6.0', () => {
    migrate.migrate('1.5.0', '1.5.1');

    expect(container.getContainersRaw).not.toHaveBeenCalled();
  });

  test('does not run when the target version is not valid semver', () => {
    migrate.migrate('1.5.1', 'not-a-semver');

    expect(container.getContainersRaw).not.toHaveBeenCalled();
  });

  test('does not run when the from version is missing', () => {
    migrate.migrate(undefined, '1.6.0');

    expect(container.getContainersRaw).not.toHaveBeenCalled();
  });

  test('does not run when the from version is already at or past 1.6.0', () => {
    migrate.migrate('1.6.0', '1.6.1');

    expect(container.getContainersRaw).not.toHaveBeenCalled();
  });

  test('runs when the from version is not valid semver', () => {
    container.getContainersRaw.mockReturnValue([{ id: 'invalid-from' }]);

    migrate.migrate('not-a-semver', '1.6.0');

    expect(container.updateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'invalid-from' }),
    );
  });
});

describe('release-gated migrations on a promoted stable image', () => {
  const migrations = [
    {
      name: '1.6.0 trigger label re-derivation',
      threshold: '1.6.0',
      earlier: '1.5.2',
      later: '1.6.1',
      laterRc: '1.6.1-rc.15',
      next: '1.7.0-rc.17',
    },
    {
      name: '1.5.0 tag precision backfill',
      threshold: '1.5.0',
      earlier: '1.4.9',
      later: '1.5.1',
      laterRc: '1.5.1-rc.2',
      next: '1.5.2-rc.1',
    },
  ];

  describe.each(migrations)('$name', ({ threshold, earlier, later, laterRc, next }) => {
    beforeEach(() => {
      container.getContainersRaw.mockReturnValue([{ id: 'c1', image: { tag: { value: '1' } } }]);
    });

    test.each([
      [`${earlier} -> ${threshold}-rc.13`, earlier, `${threshold}-rc.13`, true],
      [
        `${threshold}-rc.13 -> ${laterRc} (stores that skipped it)`,
        `${threshold}-rc.13`,
        laterRc,
        true,
      ],
      [`${laterRc} -> ${next}`, laterRc, next, false],
      [`${threshold} -> ${later}`, threshold, later, false],
      [`${earlier} -> ${earlier} (target below threshold)`, earlier, earlier, false],
      [
        `${earlier} -> ${threshold}-rc.13 with invalid from`,
        'not-a-semver',
        `${threshold}-rc.13`,
        true,
      ],
      [`${earlier} -> undefined`, earlier, undefined, false],
      [`${earlier} -> not-a-semver`, earlier, 'not-a-semver', false],
      [`undefined -> ${threshold}-rc.13`, undefined, `${threshold}-rc.13`, false],
    ])('%s', (_label, from, to, runs) => {
      migrate.migrate(from, to);

      if (runs) {
        expect(container.getContainersRaw).toHaveBeenCalled();
      } else {
        expect(container.getContainersRaw).not.toHaveBeenCalled();
      }
    });
  });
});
