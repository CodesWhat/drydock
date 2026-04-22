import type { Container, ContainerUpdateOperation } from '@/types/container';

function makeOperation(
  overrides: Partial<ContainerUpdateOperation> = {},
): ContainerUpdateOperation {
  return {
    id: 'op-1',
    status: 'in-progress',
    phase: 'pulling',
    updatedAt: '2026-04-13T12:00:00.000Z',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    identityKey: 'container-1',
    name: 'web',
    image: 'nginx:latest',
    icon: '',
    currentTag: 'latest',
    newTag: '1.0.0',
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'minor',
    updateMaturity: 'fresh',
    bouncer: 'safe',
    server: 'local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

async function loadComposable() {
  vi.resetModules();
  const mod = await import('@/composables/useOperationDisplayHold');
  return mod.useOperationDisplayHold();
}

describe('useOperationDisplayHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('matches held operations by id, name, and newContainerId', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-match' });

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      newContainerId: 'container-b',
      containerName: 'web',
      now: Date.now(),
    });

    expect(hold.getDisplayUpdateOperation('web')).toEqual(operation);
    expect(hold.getDisplayUpdateOperation({ id: 'container-a', name: 'ignored' })).toEqual(
      operation,
    );
    expect(hold.getDisplayUpdateOperation({ id: 'other', name: 'web' })).toEqual(operation);

    hold.clearHeldOperation({ newContainerId: 'container-b' });
    expect(hold.getDisplayUpdateOperation('web')).toBeUndefined();
  });

  it('replaces conflicting holds that match the same target', async () => {
    const hold = await loadComposable();
    const first = makeOperation({ id: 'op-first' });
    const second = makeOperation({ id: 'op-second' });

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    hold.holdOperationDisplay({
      operationId: first.id,
      operation: first,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now(),
    });
    hold.scheduleHeldOperationRelease({ operationId: first.id });

    hold.holdOperationDisplay({
      operationId: second.id,
      operation: second,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now(),
    });

    expect(hold.getDisplayUpdateOperation('web')).toEqual(second);
    expect(hold.heldOperations.value.has(first.id)).toBe(false);
    expect(hold.heldOperations.value.has(second.id)).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('extends the hold window on every refresh so active operations survive until terminal', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-refresh' });

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now(),
    });
    const firstDisplayUntil = hold.heldOperations.value.get(operation.id)?.displayUntil;

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-b',
      newContainerId: 'container-c',
      containerName: 'web-renamed',
      now: Date.now() + 100,
    });

    const refreshed = hold.heldOperations.value.get(operation.id);
    expect(refreshed?.displayUntil).toBe((firstDisplayUntil ?? 0) + 100);
    expect(refreshed).toEqual(
      expect.objectContaining({
        containerIds: expect.arrayContaining(['container-a', 'container-b', 'container-c']),
        containerName: 'web-renamed',
      }),
    );
  });

  it('uses default timestamps, preserves existing names, and matches containerId-only clears', async () => {
    const hold = await loadComposable();

    const named = makeOperation({ id: 'op-named' });
    hold.holdOperationDisplay({
      operationId: named.id,
      operation: named,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now(),
    });
    hold.holdOperationDisplay({
      operationId: named.id,
      operation: named,
      containerId: 'container-b',
      now: Date.now() + 100,
    });

    expect(hold.heldOperations.value.get(named.id)).toEqual(
      expect.objectContaining({
        containerIds: expect.arrayContaining(['container-a', 'container-b']),
        containerName: 'web',
      }),
    );

    const unnamed = makeOperation({ id: 'op-unnamed' });
    hold.holdOperationDisplay({
      operationId: unnamed.id,
      operation: unnamed,
      containerId: 'container-only',
    });

    expect(hold.heldOperations.value.get(unnamed.id)?.displayUntil).toBe(
      Date.now() + 10 * 60 * 1000,
    );

    hold.clearHeldOperation({ containerId: 'container-only' });
    expect(hold.heldOperations.value.has(unnamed.id)).toBe(false);
  });

  it('trims active hold to the short settle window on scheduleHeldOperationRelease', async () => {
    const hold = await loadComposable();
    const active = makeOperation({ id: 'op-active' });

    hold.holdOperationDisplay({
      operationId: active.id,
      operation: active,
      containerId: 'container-a',
      newContainerId: 'container-b',
      containerName: 'web',
      now: Date.now(),
    });

    expect(
      hold.scheduleHeldOperationRelease({
        operationId: active.id,
        containerId: 'container-a',
        newContainerId: 'container-c',
        containerName: 'web-renamed',
        now: Date.now(),
      }),
    ).toBe(true);
    expect(hold.heldOperations.value.get(active.id)).toEqual(
      expect.objectContaining({
        containerIds: expect.arrayContaining(['container-a', 'container-b', 'container-c']),
        containerName: 'web-renamed',
        displayUntil: Date.now() + 1500,
      }),
    );

    await vi.advanceTimersByTimeAsync(1499);
    expect(hold.getDisplayUpdateOperation('web-renamed')).toEqual(active);
    expect(hold.heldOperations.value.has(active.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(hold.getDisplayUpdateOperation('web-renamed')).toBeUndefined();
  });

  it('clears held operations by operation id and target aliases', async () => {
    const hold = await loadComposable();
    const byId = makeOperation({ id: 'op-by-id' });
    const byName = makeOperation({ id: 'op-by-name' });
    const byNewContainerId = makeOperation({ id: 'op-by-new-id' });

    hold.holdOperationDisplay({
      operationId: byId.id,
      operation: byId,
      containerId: 'container-a',
      containerName: 'web-a',
      now: Date.now(),
    });
    hold.holdOperationDisplay({
      operationId: byName.id,
      operation: byName,
      containerId: 'container-b',
      containerName: 'web-b',
      now: Date.now(),
    });
    hold.holdOperationDisplay({
      operationId: byNewContainerId.id,
      operation: byNewContainerId,
      containerId: 'container-c',
      newContainerId: 'container-new',
      containerName: 'web-c',
      now: Date.now(),
    });

    hold.clearHeldOperation({ operationId: byId.id });
    hold.clearHeldOperation({ containerName: 'web-b' });
    hold.clearHeldOperation({ newContainerId: 'container-new' });

    expect(hold.heldOperations.value.size).toBe(0);
  });

  it('ignores clear requests that do not match any hold', async () => {
    const hold = await loadComposable();

    hold.clearHeldOperation({ operationId: 'missing' });
    hold.clearHeldOperation({ containerId: 'missing-container' });
    hold.clearHeldOperation({ newContainerId: 'missing-new' });
    hold.clearHeldOperation({ containerName: 'missing-name' });

    expect(hold.heldOperations.value.size).toBe(0);
  });

  it('removeHeldOperation false branch: release timer fires after entry was already evicted', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-evicted' });

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-evicted',
      containerName: 'evicted',
      now: Date.now(),
    });
    // Arms a release timer (setTimeout of OPERATION_DISPLAY_HOLD_MS)
    hold.scheduleHeldOperationRelease({
      operationId: operation.id,
      containerId: 'container-evicted',
      containerName: 'evicted',
      now: Date.now(),
    });

    // Manually remove the entry from the map without cancelling the pending timer.
    // This simulates an external eviction that bypasses clearReleaseTimer.
    hold.heldOperations.value.delete(operation.id);
    expect(hold.heldOperations.value.size).toBe(0);

    // Advance time so the timer fires; removeHeldOperation is called but delete
    // returns false (entry already gone). Must not throw and map stays empty.
    await vi.advanceTimersByTimeAsync(1500);

    expect(hold.heldOperations.value.size).toBe(0);
  });

  it('falls back to the held operation or the container update operation', async () => {
    const hold = await loadComposable();
    const held = makeOperation({ id: 'op-held' });
    const fallback = makeOperation({ id: 'op-fallback' });

    hold.holdOperationDisplay({
      operationId: held.id,
      operation: held,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now(),
    });

    expect(hold.getDisplayUpdateOperation('web')).toEqual(held);
    expect(
      hold.getDisplayUpdateOperation({
        id: 'container-z',
        name: 'other',
        updateOperation: fallback,
      }),
    ).toBe(fallback);
    expect(hold.getDisplayUpdateOperation('missing')).toBeUndefined();
  });

  it('treats expired holds as absent when resolving display operations', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-expired-display' });

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-expired',
      containerName: 'expired',
      now: Date.now(),
    });

    hold.scheduleHeldOperationRelease({
      operationId: operation.id,
      containerId: 'container-expired',
      containerName: 'expired',
      now: Date.now(),
    });

    await vi.advanceTimersByTimeAsync(2000);

    expect(hold.getDisplayUpdateOperation('expired')).toBeUndefined();
    expect(
      hold.projectContainerDisplayState(
        makeContainer({
          name: 'expired',
          updateOperation: makeOperation({ id: 'op-fallback' }),
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        name: 'expired',
        updateOperation: expect.objectContaining({ id: 'op-fallback' }),
      }),
    );
  });

  it('returns the same container reference when no held update or sort snapshot applies', async () => {
    const hold = await loadComposable();
    const updateOperation = makeOperation({ id: 'op-base' });
    const container = makeContainer({ updateOperation });

    // No held operation for this container — must return same reference
    expect(hold.projectContainerDisplayState(container)).toBe(container);
  });

  it('projects container display state by cloning when a different held update applies', async () => {
    const hold = await loadComposable();
    const container = makeContainer({
      updateOperation: makeOperation({ id: 'op-original' }),
    });
    const displayOperation = makeOperation({
      id: 'op-display',
      status: 'queued',
      phase: 'queued',
    });

    hold.holdOperationDisplay({
      operationId: displayOperation.id,
      operation: displayOperation,
      containerId: container.id,
      containerName: container.name,
      now: Date.now(),
    });

    const projected = hold.projectContainerDisplayState(container);

    expect(projected).not.toBe(container);
    expect(projected).toEqual({
      ...container,
      updateOperation: displayOperation,
    });
  });

  it('clears all held operations and cancels scheduled timers', async () => {
    const hold = await loadComposable();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    hold.holdOperationDisplay({
      operationId: 'op-one',
      operation: makeOperation({ id: 'op-one' }),
      containerId: 'container-one',
      containerName: 'web-one',
      now: Date.now(),
    });
    hold.holdOperationDisplay({
      operationId: 'op-two',
      operation: makeOperation({ id: 'op-two' }),
      containerId: 'container-two',
      containerName: 'web-two',
      now: Date.now(),
    });

    hold.scheduleHeldOperationRelease({ operationId: 'op-one' });
    hold.scheduleHeldOperationRelease({ operationId: 'op-two' });

    expect(vi.getTimerCount()).toBe(2);

    hold.clearAllOperationDisplayHolds();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(hold.heldOperations.value.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(hold.heldOperations.value.size).toBe(0);
  });

  it('stores the sort snapshot on holdOperationDisplay and projects it in place of volatile fields', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-sort' });
    const sortSnapshot = {
      status: 'running' as const,
      updateKind: 'minor' as const,
      newTag: '2.0.0',
      currentTag: '1.0.0',
      image: 'nginx',
      imageCreated: '2026-04-01T00:00:00.000Z',
    };

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      sortSnapshot,
      now: Date.now(),
    });

    // Simulates mid-recreate container state: status flipped to stopped, updateKind wiped
    const volatileContainer = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'stopped',
      updateKind: null,
      newTag: null,
    });

    const projected = hold.projectContainerDisplayState(volatileContainer);

    // Sort-stable fields should reflect the pre-op snapshot, not the volatile mid-recreate values
    expect(projected.status).toBe('running');
    expect(projected.updateKind).toBe('minor');
    expect(projected.newTag).toBe('2.0.0');
  });

  it('does not override sort fields when no sort snapshot is held', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-no-snapshot' });

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      // no sortSnapshot
      now: Date.now(),
    });

    const container = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'stopped',
      updateKind: null,
      newTag: null,
    });

    const projected = hold.projectContainerDisplayState(container);
    // Without a snapshot the container fields are left untouched
    expect(projected.status).toBe('stopped');
    expect(projected.updateKind).toBeNull();
    expect(projected.newTag).toBeNull();
  });

  it('preserves the first sort snapshot when holdOperationDisplay is called again without one', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-preserve' });
    const sortSnapshot = {
      status: 'running' as const,
      updateKind: 'patch' as const,
      newTag: '1.1.1',
      currentTag: '1.1.0',
      image: 'nginx',
      imageCreated: '2026-04-01T00:00:00.000Z',
    };

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      sortSnapshot,
      now: Date.now(),
    });

    // Second call without sortSnapshot (e.g. a phase update) must not wipe the snapshot
    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      now: Date.now() + 100,
    });

    expect(hold.heldOperations.value.get(operation.id)?.sortSnapshot).toEqual(sortSnapshot);
  });

  it('projects both sort fields and held updateOperation when container fields are volatile', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-sort-only' });
    const sortSnapshot = {
      status: 'running' as const,
      updateKind: 'minor' as const,
      newTag: '2.0.0',
      currentTag: '1.0.0',
      image: 'nginx',
      imageCreated: '2026-04-01T00:00:00.000Z',
    };

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      sortSnapshot,
      now: Date.now(),
    });

    // Container in mid-recreate volatile state
    const container = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'stopped', // volatile: differs from snapshot
      updateKind: null, // volatile: differs from snapshot
      newTag: null, // volatile: differs from snapshot
    });

    const projected = hold.projectContainerDisplayState(container);
    // Sort fields projected from snapshot
    expect(projected.status).toBe('running');
    expect(projected.updateKind).toBe('minor');
    expect(projected.newTag).toBe('2.0.0');
    // updateOperation also applied from held operation
    expect(projected.updateOperation).toStrictEqual(operation);
  });

  it('stabilises currentTag, image, and imageCreated so version/image/imageAge sorts do not shift mid-update', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-version-sort' });
    const sortSnapshot = {
      status: 'running' as const,
      updateKind: 'minor' as const,
      newTag: '2.0.0',
      currentTag: '1.0.0',
      image: 'nginx',
      imageCreated: '2026-01-01T00:00:00.000Z',
    };

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      sortSnapshot,
      now: Date.now(),
    });

    // Post-update container with new tag applied and new image-created timestamp
    const updatedContainer = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'running',
      updateKind: null,
      newTag: null,
      currentTag: '2.0.0',
      image: 'nginx',
      imageCreated: '2026-04-13T12:00:00.000Z',
    });

    const projected = hold.projectContainerDisplayState(updatedContainer);
    expect(projected.currentTag).toBe('1.0.0');
    expect(projected.imageCreated).toBe('2026-01-01T00:00:00.000Z');
    expect(projected.newTag).toBe('2.0.0');
  });

  describe('reconcileHoldsAgainstContainers', () => {
    it('reconciles a hold when the raw container has no updateOperation', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-undef' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
      );

      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(t0 + 1500);

      await vi.advanceTimersByTimeAsync(1500);
      expect(hold.heldOperations.value.has(operation.id)).toBe(false);
    });

    it('reconciles a hold when the raw container updateOperation is terminal (succeeded)', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-terminal' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      hold.reconcileHoldsAgainstContainers(
        [
          makeContainer({
            id: 'c1',
            name: 'web',
            updateOperation: makeOperation({ id: 'op-reconcile-terminal', status: 'succeeded' }),
          }),
        ],
        t0,
      );

      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(t0 + 1500);

      await vi.advanceTimersByTimeAsync(1500);
      expect(hold.heldOperations.value.has(operation.id)).toBe(false);
    });

    it('does not reconcile when the raw container updateOperation is still active', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-active', status: 'in-progress' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const fullWindow = t0 + 10 * 60 * 1000;

      hold.reconcileHoldsAgainstContainers(
        [
          makeContainer({
            id: 'c1',
            name: 'web',
            updateOperation: makeOperation({ id: 'op-reconcile-active', status: 'in-progress' }),
          }),
        ],
        t0,
      );

      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(fullWindow);
    });

    it('does not reconcile when no matching container is in the list', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-no-match' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'nginx',
        now: t0,
      });

      const fullWindow = t0 + 10 * 60 * 1000;

      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c2', name: 'redis', updateOperation: undefined })],
        t0,
      );

      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(fullWindow);
    });

    it('does not re-trim a hold already in the settle window', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-already-settling' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      // Manually trim into settle window at t0 → displayUntil = t0 + 1500
      hold.scheduleHeldOperationRelease({
        operationId: operation.id,
        containerId: 'c1',
        now: t0,
      });

      // Advance 500ms so now = t0 + 500; displayUntil is still t0 + 1500
      await vi.advanceTimersByTimeAsync(500);
      const t500 = Date.now(); // t0 + 500

      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t500,
      );

      // displayUntil must remain t0 + 1500, not be reset to t500 + 1500 = t0 + 2000
      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(t0 + 1500);
    });

    it('matches by container name when the container id has changed (recreate scenario)', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-reconcile-name-fallback' });
      const t0 = Date.now();

      // Hold was keyed under old container id
      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'old-id',
        containerName: 'web',
        now: t0,
      });

      // New container has a different id but the same name (post-recreate)
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'new-id', name: 'web', updateOperation: undefined })],
        t0,
      );

      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(t0 + 1500);

      await vi.advanceTimersByTimeAsync(1500);
      expect(hold.heldOperations.value.has(operation.id)).toBe(false);
    });
  });

  it('getHeldOperation skips a hold whose displayUntil has already passed (line 142 branch)', async () => {
    const hold = await loadComposable();
    const heldOp = makeOperation({ id: 'op-expired-skip' });
    const fallbackOp = makeOperation({ id: 'op-fallback-skip' });
    const t0 = Date.now();

    // Place an active hold, then schedule release so displayUntil = t0 + 1500
    hold.holdOperationDisplay({
      operationId: heldOp.id,
      operation: heldOp,
      containerId: 'container-skip',
      containerName: 'skip-web',
      now: t0,
    });
    hold.scheduleHeldOperationRelease({
      operationId: heldOp.id,
      containerId: 'container-skip',
      containerName: 'skip-web',
      now: t0,
    });

    // Advance past displayUntil so the record is stale but NOT yet removed by the timer
    // (we're testing the guard inside getHeldOperation, not the timer removal)
    vi.setSystemTime(new Date(t0 + 1500 + 1));

    // The hold record may still be in the map (timer hasn't fired in this test), but
    // getHeldOperation must skip it because displayUntil <= now
    const container = makeContainer({
      id: 'container-skip',
      name: 'skip-web',
      updateOperation: fallbackOp,
    });
    expect(hold.getDisplayUpdateOperation(container)).toBe(fallbackOp);
  });

  it('getHeldState skips expired holds so projectContainerDisplayState returns container unchanged (line 247 branch)', async () => {
    const hold = await loadComposable();
    const heldOp = makeOperation({ id: 'op-state-expired' });
    const containerOp = makeOperation({ id: 'op-container-own' });
    const t0 = Date.now();

    hold.holdOperationDisplay({
      operationId: heldOp.id,
      operation: heldOp,
      containerId: 'container-state',
      containerName: 'state-web',
      now: t0,
    });
    hold.scheduleHeldOperationRelease({
      operationId: heldOp.id,
      containerId: 'container-state',
      containerName: 'state-web',
      now: t0,
    });

    // Advance past displayUntil before the timer fires
    vi.setSystemTime(new Date(t0 + 1500 + 1));

    const container = makeContainer({
      id: 'container-state',
      name: 'state-web',
      updateOperation: containerOp,
    });

    // Expired hold — projectContainerDisplayState must return container as-is (same reference)
    expect(hold.projectContainerDisplayState(container)).toBe(container);
  });

  it('sort snapshot projection does not override sort fields when they already match the snapshot', async () => {
    const hold = await loadComposable();
    const operation = makeOperation({ id: 'op-same-sort' });
    const sortSnapshot = {
      status: 'running' as const,
      updateKind: 'minor' as const,
      newTag: '2.0.0',
      currentTag: '1.0.0',
      image: 'nginx',
      imageCreated: '2026-04-01T00:00:00.000Z',
    };

    hold.holdOperationDisplay({
      operationId: operation.id,
      operation,
      containerId: 'container-a',
      containerName: 'web',
      sortSnapshot,
      now: Date.now(),
    });

    const container = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'running',
      updateKind: 'minor',
      newTag: '2.0.0',
      updateOperation: operation,
    });

    const projected = hold.projectContainerDisplayState(container);
    // Fields must be unchanged — projection should be a no-op in value terms
    expect(projected.status).toBe('running');
    expect(projected.updateKind).toBe('minor');
    expect(projected.newTag).toBe('2.0.0');
    // Verify that volatile-field changes ARE projected when they don't match
    const volatile = makeContainer({
      id: 'container-a',
      name: 'web',
      status: 'stopped',
      updateKind: null,
      newTag: null,
    });
    const projectedVolatile = hold.projectContainerDisplayState(volatile);
    expect(projectedVolatile.status).toBe('running');
    expect(projectedVolatile.updateKind).toBe('minor');
    expect(projectedVolatile.newTag).toBe('2.0.0');
  });
});
