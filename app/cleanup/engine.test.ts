const { mockGetAllBackups } = vi.hoisted(() => ({ mockGetAllBackups: vi.fn() }));
vi.mock('../store/backup.js', () => ({ getAllBackups: mockGetAllBackups }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import { HOUR, makeApi, makeHost, makePolicy, NOW } from './cleanup.test.helpers.js';
import { executeCleanup } from './engine.js';

const DAY_AGO_SECONDS = (NOW - 24 * HOUR) / 1000;

function image(id: string, extra: Record<string, unknown> = {}) {
  return {
    Id: id,
    RepoTags: [`repo/${id}:1`],
    RepoDigests: [],
    Size: 100,
    SharedSize: 20,
    Created: DAY_AGO_SECONDS,
    Labels: null,
    ...extra,
  };
}

describe('executeCleanup', () => {
  beforeEach(() => {
    mockGetAllBackups.mockReset().mockReturnValue([]);
  });

  describe('dangling images', () => {
    const images = [
      image('dangling-1', { RepoTags: [], Size: 50, SharedSize: -1 }),
      image('dangling-none', { RepoTags: ['<none>:<none>'], Size: 10, SharedSize: 0 }),
      image('dangling-used', { RepoTags: [] }),
      image('dangling-excluded', { RepoTags: [], Labels: { 'dd.cleanup.exclude': 'true' } }),
      image('dangling-nosize', { RepoTags: [], Size: 7, SharedSize: undefined }),
      image('tagged'),
    ];
    const containers = [{ Id: 'c1', ImageID: 'dangling-used', State: 'running', Names: ['/a'] }];

    test('removes untagged unused images only, reporting bytes', async () => {
      const { api, mocks, imageRemove } = makeApi({
        listImages: vi.fn().mockResolvedValue(images),
        listContainers: vi.fn().mockResolvedValue(containers),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { danglingImages: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.getImage.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        'dangling-1',
        'dangling-none',
        'dangling-nosize',
      ]);
      expect(imageRemove).toHaveBeenCalledWith({ force: false });
      expect(result.types.danglingImages).toEqual({
        candidates: 3,
        removed: 3,
        reclaimedBytes: 67,
        skipped: 1,
        errors: [],
      });
      expect(result.totalReclaimedBytes).toBe(67);
      expect(mocks.listContainers).toHaveBeenCalledWith({ all: true, size: false });
    });

    test('dry run reports without removing', async () => {
      const { api, mocks } = makeApi({
        listImages: vi.fn().mockResolvedValue(images),
        listContainers: vi.fn().mockResolvedValue(containers),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { danglingImages: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(mocks.getImage).not.toHaveBeenCalled();
      expect(result.types.danglingImages).toMatchObject({
        candidates: 3,
        removed: 0,
        reclaimedBytes: 67,
      });
    });

    test('is not touched when the type is not opted in', async () => {
      const { api, mocks } = makeApi({ listImages: vi.fn().mockResolvedValue(images) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { networks: true } as never }),
        {
          dryRun: false,
          now: NOW,
        },
      );
      expect(mocks.listImages).not.toHaveBeenCalled();
      expect(result.types.danglingImages).toBeUndefined();
    });

    test('records a per-image removal failure and keeps going', async () => {
      const { api, imageRemove } = makeApi({
        listImages: vi.fn().mockResolvedValue(images),
      });
      imageRemove.mockRejectedValueOnce(new Error('conflict')).mockResolvedValue(undefined);
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { danglingImages: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.danglingImages).toMatchObject({
        removed: 3,
        skipped: 2,
        errors: ['dangling-1: conflict'],
      });
    });

    test('caps the recorded errors', async () => {
      const many = Array.from({ length: 15 }, (_, index) => image(`d${index}`, { RepoTags: [] }));
      const { api, imageRemove } = makeApi({ listImages: vi.fn().mockResolvedValue(many) });
      imageRemove.mockRejectedValue(new Error('no'));
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { danglingImages: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.danglingImages?.errors).toHaveLength(10);
      expect(result.types.danglingImages?.skipped).toBe(15);
    });
  });

  describe('unused images', () => {
    const images = [
      image('old-unused', { Created: (NOW - 100 * HOUR) / 1000 }),
      image('old-multi', {
        RepoTags: ['a/x:1', 'a/x:2'],
        Created: (NOW - 100 * HOUR) / 1000,
      }),
      image('young-unused', { Created: (NOW - HOUR) / 1000 }),
      image('old-used', { Created: (NOW - 100 * HOUR) / 1000 }),
      image('old-excluded', {
        Created: (NOW - 100 * HOUR) / 1000,
        Labels: { 'dd.cleanup.exclude': 'true' },
      }),
      image('untagged', { RepoTags: undefined, Created: (NOW - 100 * HOUR) / 1000 }),
    ];
    const containers = [{ Id: 'c', ImageID: 'old-used', State: 'exited', Names: ['/b'] }];

    test('honours the older-than filter, usage and exclusion label', async () => {
      const { api, mocks, imageRemove } = makeApi({
        listImages: vi.fn().mockResolvedValue(images),
        listContainers: vi.fn().mockResolvedValue(containers),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({
          types: { unusedImages: true } as never,
          unusedImagesOlderThanHours: 48,
        }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.getImage.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        'old-unused',
        'old-multi',
      ]);
      expect(imageRemove).toHaveBeenNthCalledWith(1, { force: false });
      expect(imageRemove).toHaveBeenNthCalledWith(2, { force: true });
      expect(result.types.unusedImages).toMatchObject({ candidates: 2, removed: 2, skipped: 1 });
    });

    test('never removes an image that is the rollback backup of a recent update', async () => {
      mockGetAllBackups.mockReturnValue([
        {
          imageName: 'repo/old-unused',
          imageTag: '1',
          timestamp: new Date(NOW - HOUR).toISOString(),
        },
      ]);
      const { api, mocks } = makeApi({
        listImages: vi.fn().mockResolvedValue([images[0]]),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { unusedImages: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.getImage).not.toHaveBeenCalled();
      expect(result.types.unusedImages).toMatchObject({ candidates: 0, skipped: 1 });
    });

    test('a backup outside the rollback window no longer protects the image', async () => {
      mockGetAllBackups.mockReturnValue([
        {
          imageName: 'repo/old-unused',
          imageTag: '1',
          timestamp: new Date(NOW - 500 * HOUR).toISOString(),
        },
      ]);
      const { api, mocks } = makeApi({ listImages: vi.fn().mockResolvedValue([images[0]]) });
      await executeCleanup(makeHost(api), makePolicy({ types: { unusedImages: true } as never }), {
        dryRun: false,
        now: NOW,
      });
      expect(mocks.getImage).toHaveBeenCalledWith('old-unused');
    });

    test('defaults the clock to now', async () => {
      const { api, mocks } = makeApi({
        listImages: vi.fn().mockResolvedValue([image('ancient', { Created: 1 })]),
      });
      await executeCleanup(makeHost(api), makePolicy({ types: { unusedImages: true } as never }), {
        dryRun: true,
      });
      expect(mocks.listImages).toHaveBeenCalled();
    });
  });

  describe('stopped containers', () => {
    const containers = [
      { Id: 'stopped', State: 'exited', Names: ['/job'], SizeRw: 30, Labels: {} },
      { Id: 'created', State: 'created', Names: ['/c'], Labels: {} },
      { Id: 'running', State: 'running', Names: ['/run'], Labels: {} },
      {
        Id: 'excluded',
        State: 'exited',
        Names: ['/keep'],
        Labels: { 'dd.cleanup.exclude': 'true' },
      },
      { Id: 'rollback', State: 'exited', Names: [`/web-old-${NOW - 2 * HOUR}`], Labels: {} },
      { Id: 'stale-old', State: 'exited', Names: [`/web-old-${NOW - 900 * HOUR}`], Labels: {} },
      { Id: 'nameless', State: 'dead', Labels: {} },
    ];

    test('removes stopped containers but keeps excluded and recent rollback ones', async () => {
      const { api, mocks, containerRemove } = makeApi({
        listContainers: vi.fn().mockResolvedValue(containers),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { stoppedContainers: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.getContainer.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        'stopped',
        'created',
        'stale-old',
        'nameless',
      ]);
      expect(containerRemove).toHaveBeenCalledWith({ v: false });
      expect(mocks.listContainers).toHaveBeenCalledWith({ all: true, size: true });
      expect(result.types.stoppedContainers).toMatchObject({
        candidates: 4,
        removed: 4,
        reclaimedBytes: 30,
        skipped: 2,
      });
    });

    test('dry run removes nothing', async () => {
      const { api, mocks } = makeApi({ listContainers: vi.fn().mockResolvedValue(containers) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { stoppedContainers: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(mocks.getContainer).not.toHaveBeenCalled();
      expect(result.types.stoppedContainers).toMatchObject({ candidates: 4, removed: 0 });
    });
  });

  describe('networks', () => {
    const old = new Date(NOW - 5 * HOUR).toISOString();
    const networks = [
      { Name: 'bridge', Scope: 'local', Created: old },
      { Name: 'swarmy', Scope: 'swarm', Created: old },
      { Name: 'ingress', Scope: 'local', Ingress: true, Created: old },
      { Name: 'busy', Scope: 'local', Created: old, Containers: { a: {} } },
      { Name: 'fresh', Scope: 'local', Created: new Date(NOW - 60_000).toISOString() },
      {
        Name: 'excluded',
        Scope: 'local',
        Created: old,
        Labels: { 'dd.cleanup.exclude': 'true' },
      },
      { Name: 'idle', Scope: 'local', Created: old, Containers: {} },
      { Name: 'undated', Scope: 'local' },
    ];

    test('prunes through the Docker API with the exclusion label filter', async () => {
      const { api, mocks } = makeApi({
        listNetworks: vi.fn().mockResolvedValue(networks),
        pruneNetworks: vi.fn().mockResolvedValue({ NetworksDeleted: ['idle'] }),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { networks: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.pruneNetworks).toHaveBeenCalledWith({
        filters: { 'label!': ['dd.cleanup.exclude=true'], until: ['1h'] },
      });
      expect(result.types.networks).toMatchObject({ candidates: 2, removed: 1, skipped: 1 });
    });

    test('handles an empty NetworksDeleted and skips the call when nothing matches', async () => {
      const { api, mocks } = makeApi({
        listNetworks: vi.fn().mockResolvedValue([networks[0]]),
      });
      await executeCleanup(makeHost(api), makePolicy({ types: { networks: true } as never }), {
        dryRun: false,
        now: NOW,
      });
      expect(mocks.pruneNetworks).not.toHaveBeenCalled();

      const second = makeApi({
        listNetworks: vi.fn().mockResolvedValue([networks[6]]),
        pruneNetworks: vi.fn().mockResolvedValue({}),
      });
      const result = await executeCleanup(
        makeHost(second.api),
        makePolicy({ types: { networks: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.networks?.removed).toBe(0);
    });

    test('dry run lists candidates without pruning', async () => {
      const { api, mocks } = makeApi({ listNetworks: vi.fn().mockResolvedValue(networks) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { networks: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(mocks.pruneNetworks).not.toHaveBeenCalled();
      expect(result.types.networks).toMatchObject({ candidates: 2, removed: 0 });
    });

    test('records a prune failure', async () => {
      const { api } = makeApi({
        listNetworks: vi.fn().mockResolvedValue([networks[6]]),
        pruneNetworks: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { networks: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.networks?.errors).toEqual(['prune: boom']);
    });
  });

  describe('build cache', () => {
    const usage = {
      BuildCache: [{ InUse: false, Size: 70 }, { InUse: true, Size: 500 }, { Size: 30 }],
    };

    test('prunes unused cache and reports the reclaimed bytes', async () => {
      const { api, mocks } = makeApi({
        df: vi.fn().mockResolvedValue(usage),
        pruneBuilder: vi.fn().mockResolvedValue({ SpaceReclaimed: 90 }),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { buildCache: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.pruneBuilder).toHaveBeenCalledWith({ all: true });
      expect(result.types.buildCache).toMatchObject({
        candidates: 2,
        removed: 2,
        reclaimedBytes: 90,
      });
    });

    test('treats a missing SpaceReclaimed as zero and a dry run as an estimate', async () => {
      const first = makeApi({
        df: vi.fn().mockResolvedValue(usage),
        pruneBuilder: vi.fn().mockResolvedValue({}),
      });
      const real = await executeCleanup(
        makeHost(first.api),
        makePolicy({ types: { buildCache: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(real.types.buildCache?.reclaimedBytes).toBe(0);

      const second = makeApi({ df: vi.fn().mockResolvedValue({ BuildCache: [{ Size: 5 }, {}] }) });
      const dry = await executeCleanup(
        makeHost(second.api),
        makePolicy({ types: { buildCache: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(second.mocks.pruneBuilder).not.toHaveBeenCalled();
      expect(dry.types.buildCache?.reclaimedBytes).toBe(5);
    });

    test('tolerates a usage report without cache entries', async () => {
      const { api } = makeApi({ df: vi.fn().mockResolvedValue({}) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { buildCache: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.buildCache?.candidates).toBe(0);
    });
  });

  describe('volumes', () => {
    const anon = 'a'.repeat(64);
    const anonUsed = 'b'.repeat(64);
    const anonExcluded = 'c'.repeat(64);
    const anonYoung = 'd'.repeat(64);
    const anonNoSize = 'e'.repeat(64);
    const old = new Date(NOW - 500 * HOUR).toISOString();
    const usage = {
      Volumes: [
        { Name: anon, CreatedAt: old, UsageData: { RefCount: 0, Size: 40 } },
        { Name: anonUsed, CreatedAt: old, UsageData: { RefCount: 1, Size: 99 } },
        {
          Name: anonExcluded,
          CreatedAt: old,
          Labels: { 'dd.cleanup.exclude': 'true' },
          UsageData: { RefCount: 0, Size: 1 },
        },
        {
          Name: anonYoung,
          CreatedAt: new Date(NOW - HOUR).toISOString(),
          UsageData: { RefCount: 0, Size: 1 },
        },
        { Name: anonNoSize, CreatedAt: old, UsageData: { RefCount: 0 } },
        { Name: 'named-data', CreatedAt: old, UsageData: { RefCount: 0, Size: 1000 } },
        { Name: 'f'.repeat(64), CreatedAt: old },
        { Name: 'a1'.repeat(32), UsageData: { RefCount: 0, Size: 2 } },
      ],
    };

    test('removes only idle anonymous volumes outside the protection window', async () => {
      const { api, mocks, volumeRemove } = makeApi({ df: vi.fn().mockResolvedValue(usage) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { volumes: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(mocks.getVolume.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        anon,
        anonNoSize,
        'a1'.repeat(32),
      ]);
      expect(volumeRemove).toHaveBeenCalledWith();
      expect(result.types.volumes).toMatchObject({
        candidates: 3,
        removed: 3,
        reclaimedBytes: 42,
        skipped: 2,
      });
    });

    test('judges volumes against the snapshot taken before containers are removed', async () => {
      const order: string[] = [];
      const { api } = makeApi({
        df: vi.fn(async () => {
          order.push('df');
          return usage;
        }),
        listContainers: vi
          .fn()
          .mockResolvedValue([{ Id: 'gone', State: 'exited', Names: ['/gone'], Labels: {} }]),
        getContainer: vi.fn(() => ({
          remove: async () => {
            order.push('container-removed');
          },
        })),
      });
      await executeCleanup(
        makeHost(api),
        makePolicy({ types: { volumes: true, stoppedContainers: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(order).toEqual(['df', 'container-removed']);
    });

    test('dry run removes nothing', async () => {
      const { api, mocks } = makeApi({ df: vi.fn().mockResolvedValue(usage) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { volumes: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(mocks.getVolume).not.toHaveBeenCalled();
      expect(result.types.volumes).toMatchObject({ candidates: 3, removed: 0, reclaimedBytes: 42 });
    });

    test('tolerates a usage report without volumes', async () => {
      const { api } = makeApi({ df: vi.fn().mockResolvedValue({}) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { volumes: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.volumes?.candidates).toBe(0);
    });
  });

  describe('failures', () => {
    test('a shared listing failure is recorded on every enabled type', async () => {
      const { api } = makeApi({ listContainers: vi.fn().mockRejectedValue(new Error('down')) });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { unusedImages: true, stoppedContainers: true } as never }),
        { dryRun: false, now: NOW },
      );
      expect(result.types.unusedImages?.errors).toEqual(['down']);
      expect(result.types.stoppedContainers?.errors).toEqual(['down']);
      expect(result.totalReclaimedBytes).toBe(0);
    });

    test('a failing type does not stop the others', async () => {
      const { api, mocks } = makeApi({
        listNetworks: vi.fn().mockRejectedValue(new Error('net down')),
        df: vi.fn().mockResolvedValue({ BuildCache: [{ Size: 1 }] }),
      });
      const result = await executeCleanup(
        makeHost(api),
        makePolicy({ types: { networks: true, buildCache: true } as never }),
        { dryRun: true, now: NOW },
      );
      expect(result.types.networks?.errors).toEqual(['net down']);
      expect(result.types.buildCache?.candidates).toBe(1);
      expect(mocks.df).toHaveBeenCalledTimes(1);
    });
  });
});
