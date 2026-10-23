import {
  buildFollowOwnerHostConfig,
  recreateSharedNamespaceDependents,
  type SharedNamespaceContainerSpec,
} from './SharedNamespaceDependents.js';

const OLD_ID = 'a'.repeat(64);
const NEW_ID = 'b'.repeat(64);

describe('buildFollowOwnerHostConfig', () => {
  const resolveOwner = (reference: string) =>
    reference === OLD_ID || reference === OLD_ID.slice(0, 12)
      ? { kind: 'id' as const, newId: NEW_ID }
      : reference === 'vpn'
        ? { kind: 'name' as const, newId: NEW_ID }
        : undefined;

  test('returns undefined without a host config or any matching reference', () => {
    expect(buildFollowOwnerHostConfig(undefined, resolveOwner)).toBeUndefined();
    expect(
      buildFollowOwnerHostConfig(
        { NetworkMode: 'bridge', VolumesFrom: ['other', `${'c'.repeat(64)}:ro`] },
        resolveOwner,
      ),
    ).toBeUndefined();
    expect(
      buildFollowOwnerHostConfig({ NetworkMode: `container:${'c'.repeat(64)}` }, resolveOwner),
    ).toBeUndefined();
    expect(buildFollowOwnerHostConfig({ VolumesFrom: null }, resolveOwner)).toBeUndefined();
  });

  test('repoints a network namespace reference and keeps other settings', () => {
    expect(
      buildFollowOwnerHostConfig(
        { NetworkMode: `container:${OLD_ID.slice(0, 12)}`, Binds: ['/a:/a'] },
        resolveOwner,
      ),
    ).toEqual({ NetworkMode: `container:${NEW_ID}`, Binds: ['/a:/a'] });
  });

  test('repoints volumes_from by id keeping the mode, and keeps name references', () => {
    expect(
      buildFollowOwnerHostConfig(
        { VolumesFrom: [`${OLD_ID}:ro`, 'vpn:rw', 'other'] },
        resolveOwner,
      ),
    ).toEqual({ VolumesFrom: [`${NEW_ID}:ro`, 'vpn:rw', 'other'] });
  });
});

type Spec = SharedNamespaceContainerSpec;

function createApi(initial: Record<string, Spec>) {
  const specs = new Map<string, Spec>(Object.values(initial).map((spec) => [spec.Id, spec]));
  const byRef = (identifier: string) =>
    specs.get(identifier) ?? [...specs.values()].find((spec) => spec.Name === `/${identifier}`);
  return {
    specs,
    listContainers: vi.fn(async () => [...specs.keys()].map((Id) => ({ Id }))),
    getContainer: vi.fn((identifier: string) => ({
      inspect: vi.fn(async () => {
        const spec = byRef(identifier);
        if (!spec) {
          throw new Error(`no such container ${identifier}`);
        }
        return spec;
      }),
    })),
  };
}

/** A recreate double that swaps the container for one with a new id, like Docker would. */
function createRecreate(api: ReturnType<typeof createApi>, calls: Array<[string, unknown]> = []) {
  return vi.fn(async (spec: Spec, hostConfig: unknown) => {
    calls.push([spec.Name, hostConfig]);
    api.specs.delete(spec.Id);
    api.specs.set(`new-${spec.Id}`, {
      ...spec,
      Id: `new-${spec.Id}`,
      HostConfig: hostConfig as Spec['HostConfig'],
    });
  });
}

function createLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

const owner: Spec = { Id: NEW_ID, Name: '/vpn', HostConfig: {} };

describe('recreateSharedNamespaceDependents', () => {
  test('recreates only containers borrowing from the previous owner', async () => {
    const api = createApi({
      [NEW_ID]: owner,
      d1: { Id: 'd1', Name: '/app', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
      d2: { Id: 'd2', Name: '/unrelated', HostConfig: { NetworkMode: 'bridge' } },
      d3: { Id: 'd3', Name: '/sidecar', HostConfig: { VolumesFrom: ['vpn'] } },
      gone: { Id: 'gone', Name: '/gone', HostConfig: {} },
    });
    api.getContainer.mockImplementationOnce(api.getContainer).mockImplementation((id: string) => ({
      inspect: vi.fn(async () => {
        if (id === 'gone') {
          throw new Error('removed meanwhile');
        }
        return api.specs.get(id) ?? [...api.specs.values()].find((s) => s.Name === `/${id}`)!;
      }),
    }));
    const calls: Array<[string, unknown]> = [];
    const log = createLog();

    const result = await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: log,
      recreateDependent: createRecreate(api, calls),
    });

    expect(result.failures).toEqual([]);
    expect(calls).toEqual([
      ['/app', { NetworkMode: `container:${NEW_ID}` }],
      ['/sidecar', { VolumesFrom: ['vpn'] }],
    ]);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Recreate app'));
  });

  test('recurses into borrowers of a recreated borrower with the new id', async () => {
    const api = createApi({
      [NEW_ID]: owner,
      mid: { Id: 'mid', Name: '/mid', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
      leaf: { Id: 'leaf', Name: '/leaf', HostConfig: { NetworkMode: 'container:mid' } },
    });
    const calls: Array<[string, unknown]> = [];

    await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: createLog(),
      recreateDependent: createRecreate(api, calls),
    });

    expect(calls).toEqual([
      ['/mid', { NetworkMode: `container:${NEW_ID}` }],
      ['/leaf', { NetworkMode: 'container:new-mid' }],
    ]);
  });

  test('rewrites every reference of a container that depends on several recreated ones (A, B, C)', async () => {
    // B uses A's network. C uses A's network and B's volumes. Listed C first to
    // prove ordering comes from the dependencies, not from list order.
    const api = createApi({
      [NEW_ID]: owner,
      c: {
        Id: 'c',
        Name: '/c',
        HostConfig: { NetworkMode: `container:${OLD_ID}`, VolumesFrom: ['b:ro', 'unrelated'] },
      },
      b: { Id: 'b-id', Name: '/b', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
    });
    const calls: Array<[string, unknown]> = [];

    const result = await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: createLog(),
      recreateDependent: createRecreate(api, calls),
    });

    expect(result.failures).toEqual([]);
    expect(calls).toEqual([
      ['/b', { NetworkMode: `container:${NEW_ID}` }],
      ['/c', { NetworkMode: `container:${NEW_ID}`, VolumesFrom: ['b:ro', 'unrelated'] }],
    ]);
  });

  test('moves a volumes_from id reference to the recreated container id', async () => {
    const api = createApi({
      [NEW_ID]: owner,
      b: { Id: 'e'.repeat(64), Name: '/b', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
      c: {
        Id: 'c',
        Name: '/c',
        HostConfig: { VolumesFrom: [`${'e'.repeat(64)}:ro`] },
      },
    });
    const calls: Array<[string, unknown]> = [];

    await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: createLog(),
      recreateDependent: createRecreate(api, calls),
    });

    expect(calls[1]).toEqual(['/c', { VolumesFrom: [`new-${'e'.repeat(64)}:ro`] }]);
  });

  test('warns and gives up when the owner or the container list cannot be read', async () => {
    const log = createLog();
    const recreateDependent = vi.fn();

    const result = await recreateSharedNamespaceDependents({
      dockerApi: {
        listContainers: vi.fn(),
        getContainer: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(new Error('gone')) })),
      },
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: log,
      recreateDependent,
    });

    expect(result.failures).toEqual([expect.stringContaining('vpn (gone)')]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('vpn (gone)'));
    expect(recreateDependent).not.toHaveBeenCalled();
  });

  test('reports a failed borrower, still handles siblings and skips what depended on it', async () => {
    const api = createApi({
      [NEW_ID]: owner,
      bad: { Id: 'bad', Name: '/bad', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
      child: { Id: 'child', Name: '/child', HostConfig: { VolumesFrom: ['bad'] } },
      good: { Id: 'good', Name: '/good', HostConfig: { NetworkMode: `container:${OLD_ID}` } },
    });
    const calls: Array<[string, unknown]> = [];
    const okRecreate = createRecreate(api, calls);
    const recreateDependent = vi.fn(async (spec: Spec, hostConfig: unknown) => {
      if (spec.Name === '/bad') {
        throw new Error('create failed');
      }
      return okRecreate(spec, hostConfig as never);
    });
    const log = createLog();

    const result = await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: log,
      recreateDependent,
    });

    expect(calls.map(([name]) => name)).toEqual(['/good']);
    expect(result.failures).toEqual([
      'Unable to recreate bad (create failed)',
      expect.stringContaining('Skipped child'),
    ]);
  });

  test('reports containers caught in a circular reference instead of looping', async () => {
    const api = createApi({
      [NEW_ID]: owner,
      x: {
        Id: 'x',
        Name: '/x',
        HostConfig: { NetworkMode: `container:${OLD_ID}`, VolumesFrom: ['y'] },
      },
      y: { Id: 'y', Name: '/y', HostConfig: { VolumesFrom: ['x'] } },
    });

    const result = await recreateSharedNamespaceDependents({
      dockerApi: api,
      previousContainerId: OLD_ID,
      containerName: 'vpn',
      logContainer: createLog(),
      recreateDependent: createRecreate(api),
    });

    expect(result.failures).toEqual([expect.stringContaining('circular')]);
  });
});
