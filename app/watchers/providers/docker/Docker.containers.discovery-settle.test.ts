import { setupDockerWatcherContainerSuite } from './Docker.containers.test.helpers.js';

describe('Docker Watcher discovery settling (#156)', () => {
  let docker;
  let mockDockerApi;
  // Docker.ts resolves its store reference from the mock instance the helpers
  // file's vi.mock() call creates, which differs from a static import in this
  // file — use a dynamic import to get the same mocked instance (see the same
  // pattern in Docker.containers.additional-coverage-helpers.test.ts).
  let hStoreContainer: any;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
  });

  beforeEach(async () => {
    hStoreContainer = await import('../../../store/container.js');
    vi.useFakeTimers();
    docker.addImageDetailsToContainer = vi
      .fn()
      .mockImplementation((container) =>
        Promise.resolve({ id: container.Id, name: container.Names?.[0]?.replace(/^\//, '') }),
      );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // watchevents: false — this suite advances fake timers across the settling
  // window, which would otherwise also fire the (unrelated) docker-events
  // reconnect backoff logic and trigger spurious background watch cycles.
  test('holds a newly discovered container out of getContainers() until the settling window elapses', async () => {
    const container = { Id: 'new-container', Labels: { 'dd.watch': 'true' }, Names: ['/app'] };
    mockDockerApi.listContainers.mockResolvedValue([container]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    // Not under test here: keep the settle-deadline follow-up watch from
    // racing this test's own getContainers() passes.
    vi.spyOn(docker, 'watchFromCron').mockResolvedValue([]);

    const firstPass = await docker.getContainers();
    expect(firstPass).toHaveLength(0);
    expect(docker.addImageDetailsToContainer).not.toHaveBeenCalled();
    expect(docker.pendingDiscoveries.has('new-container')).toBe(true);

    vi.advanceTimersByTime(30_000);

    const secondPass = await docker.getContainers();
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]).toMatchObject({ id: 'new-container', name: 'app' });
    expect(docker.pendingDiscoveries.has('new-container')).toBe(false);
  });

  test('registers under the final name when the container is renamed mid-window', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'rename-me', Labels: { 'dd.watch': 'true' }, Names: ['/transient-alias-name'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 10_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    vi.spyOn(docker, 'watchFromCron').mockResolvedValue([]);
    await docker.getContainers();
    expect(docker.pendingDiscoveries.get('rename-me')?.name).toBe('transient-alias-name');

    vi.advanceTimersByTime(10_000);
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'rename-me', Labels: { 'dd.watch': 'true' }, Names: ['/final-name'] },
    ]);

    const result = await docker.getContainers();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'rename-me', name: 'final-name' });
    expect(docker.addImageDetailsToContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Names: ['/final-name'] }),
      expect.anything(),
    );
  });

  test('silently discards a container that disappears before settling', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'gone-soon', Labels: { 'dd.watch': 'true' }, Names: ['/gone-soon'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    await docker.getContainers();
    expect(docker.pendingDiscoveries.has('gone-soon')).toBe(true);

    vi.advanceTimersByTime(5_000);
    mockDockerApi.listContainers.mockResolvedValue([]);

    const result = await docker.getContainers();
    expect(result).toHaveLength(0);
    expect(docker.pendingDiscoveries.has('gone-soon')).toBe(false);
    expect(docker.addImageDetailsToContainer).not.toHaveBeenCalled();
  });

  test('bypasses settling for a container already present in the store', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'already-known', Labels: { 'dd.watch': 'true' }, Names: ['/already-known'] },
    ]);
    hStoreContainer.getContainers.mockReturnValue([
      { id: 'already-known', name: 'already-known', watcher: 'test' },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    const result = await docker.getContainers();

    expect(result).toHaveLength(1);
    expect(docker.pendingDiscoveries.size).toBe(0);
    expect(docker.addImageDetailsToContainer).toHaveBeenCalledTimes(1);
  });

  test('registers new containers immediately when discoverysettlems is 0', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'immediate', Labels: { 'dd.watch': 'true' }, Names: ['/immediate'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 0,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    const result = await docker.getContainers();

    expect(result).toHaveLength(1);
    expect(docker.pendingDiscoveries.size).toBe(0);
  });

  test('tracks multiple independently-discovered containers across watch cycles', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'multi-a', Labels: { 'dd.watch': 'true' }, Names: ['/multi-a'] },
    ]);
    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 10_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    vi.spyOn(docker, 'watchFromCron').mockResolvedValue([]);
    await docker.getContainers();

    vi.advanceTimersByTime(6_000);
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'multi-a', Labels: { 'dd.watch': 'true' }, Names: ['/multi-a'] },
      { Id: 'multi-b', Labels: { 'dd.watch': 'true' }, Names: ['/multi-b'] },
    ]);
    const midResult = await docker.getContainers();
    expect(midResult).toHaveLength(0);

    vi.advanceTimersByTime(4_500);
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'multi-a', Labels: { 'dd.watch': 'true' }, Names: ['/multi-a'] },
      { Id: 'multi-b', Labels: { 'dd.watch': 'true' }, Names: ['/multi-b'] },
    ]);
    const finalResult = await docker.getContainers();
    expect(finalResult.map((c: { id: string }) => c.id)).toEqual(['multi-a']);
    expect(docker.pendingDiscoveries.has('multi-a')).toBe(false);
    expect(docker.pendingDiscoveries.has('multi-b')).toBe(true);
  });

  test('schedules a follow-up watch so a pending container registers without another Docker event (#691 review)', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'event-only', Labels: { 'dd.watch': 'true' }, Names: ['/event-only'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    docker.watchCronDebounced = vi.fn();

    await docker.getContainers();
    expect(docker.pendingDiscoverySettleTimeout).toBeDefined();
    expect(docker.watchCronDebounced).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(docker.watchCronDebounced).toHaveBeenCalledOnce();
    expect(docker.pendingDiscoverySettleTimeout).toBeUndefined();
  });

  test('starts the watch directly at the settle deadline when watchevents is disabled (#691 review)', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'no-events', Labels: { 'dd.watch': 'true' }, Names: ['/no-events'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    // watchevents: false means init() never created watchCronDebounced — the
    // settle timer must fall back to watchFromCron() itself.
    expect(docker.watchCronDebounced).toBeUndefined();
    const watchFromCronSpy = vi.spyOn(docker, 'watchFromCron');

    await docker.getContainers();
    expect(docker.pendingDiscoveries.has('no-events')).toBe(true);
    expect(watchFromCronSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(watchFromCronSpy).toHaveBeenCalledOnce();
    await watchFromCronSpy.mock.results[0].value;

    expect(docker.pendingDiscoveries.has('no-events')).toBe(false);
    expect(docker.addImageDetailsToContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Id: 'no-events' }),
      expect.anything(),
    );
  });

  test('keeps a single deduplicated settle timer anchored to the earliest pending deadline', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'first-pending', Labels: { 'dd.watch': 'true' }, Names: ['/first-pending'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    docker.watchCronDebounced = vi.fn();

    await docker.getContainers();

    vi.advanceTimersByTime(10_000);
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'first-pending', Labels: { 'dd.watch': 'true' }, Names: ['/first-pending'] },
      { Id: 'second-pending', Labels: { 'dd.watch': 'true' }, Names: ['/second-pending'] },
    ]);
    await docker.getContainers();
    expect(docker.watchCronDebounced).not.toHaveBeenCalled();

    // fires at first-pending's deadline (20s away), not second-pending's (30s away)
    vi.advanceTimersByTime(20_000);
    expect(docker.watchCronDebounced).toHaveBeenCalledOnce();
  });

  test('does not schedule a settle timer when nothing is pending', async () => {
    mockDockerApi.listContainers.mockResolvedValue([]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);

    await docker.getContainers();
    expect(docker.pendingDiscoverySettleTimeout).toBeUndefined();
  });

  test('deregisterComponent clears the pending settle timer', async () => {
    mockDockerApi.listContainers.mockResolvedValue([
      { Id: 'pending-at-teardown', Labels: { 'dd.watch': 'true' }, Names: ['/pending'] },
    ]);

    await docker.register('watcher', 'docker', 'test', {
      discoverysettlems: 30_000,
      watchevents: false,
    });
    clearTimeout(docker.watchCronTimeout);
    const watchSpy = vi.fn();
    docker.watchCronDebounced = watchSpy;

    await docker.getContainers();
    expect(docker.pendingDiscoverySettleTimeout).toBeDefined();

    await docker.deregisterComponent();
    expect(docker.pendingDiscoverySettleTimeout).toBeUndefined();

    vi.advanceTimersByTime(60_000);
    expect(watchSpy).not.toHaveBeenCalled();
  });
});
