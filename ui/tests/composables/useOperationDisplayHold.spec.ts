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

  describe('reconcileHoldsAgainstContainers — onTerminalResolved callback', () => {
    it('invokes onTerminalResolved when a hold is collapsed due to missing active operation', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-basic' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const callback = vi.fn();
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'op-cb-basic',
          containerName: 'web',
          containerIds: expect.arrayContaining(['c1']),
        }),
      );
    });

    it('does NOT invoke onTerminalResolved when the container still has an active operation', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-active', status: 'in-progress' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const callback = vi.fn();
      hold.reconcileHoldsAgainstContainers(
        [
          makeContainer({
            id: 'c1',
            name: 'web',
            updateOperation: makeOperation({ id: 'op-cb-active', status: 'in-progress' }),
          }),
        ],
        t0,
        callback,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT invoke onTerminalResolved when the hold is already in the settle window', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-settling' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      // Trim hold into settle window first
      hold.scheduleHeldOperationRelease({ operationId: operation.id, now: t0 });

      const callback = vi.fn();
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
        callback,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT invoke onTerminalResolved when no matching container is found', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-no-match' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const callback = vi.fn();
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c2', name: 'redis', updateOperation: undefined })],
        t0,
        callback,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('still collapses the hold even when onTerminalResolved is provided', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-collapse' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const callback = vi.fn();
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
        callback,
      );

      // Hold should have been trimmed to settle window
      expect(hold.heldOperations.value.get(operation.id)?.displayUntil).toBe(t0 + 1500);

      await vi.advanceTimersByTimeAsync(1500);
      expect(hold.heldOperations.value.has(operation.id)).toBe(false);
    });

    it('does not re-invoke onTerminalResolved on subsequent reconcile passes for the same hold', async () => {
      const hold = await loadComposable();
      const operation = makeOperation({ id: 'op-cb-once' });
      const t0 = Date.now();

      hold.holdOperationDisplay({
        operationId: operation.id,
        operation,
        containerId: 'c1',
        containerName: 'web',
        now: t0,
      });

      const callback = vi.fn();

      // First reconcile — hold is still in active window → collapses to settle window
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
        callback,
      );
      expect(callback).toHaveBeenCalledOnce();

      // Second reconcile with the same hold already in settle window → skip
      hold.reconcileHoldsAgainstContainers(
        [makeContainer({ id: 'c1', name: 'web', updateOperation: undefined })],
        t0,
        callback,
      );
      expect(callback).toHaveBeenCalledOnce();
    });
  });

  async function loadModule() {
    vi.resetModules();
    return await import('@/composables/useOperationDisplayHold');
  }

  describe('parseUpdateOperationSsePayload', () => {
    it('returns undefined for non-object payloads', async () => {
      const mod = await loadModule();
      expect(mod.parseUpdateOperationSsePayload(null)).toBeUndefined();
      expect(mod.parseUpdateOperationSsePayload(undefined)).toBeUndefined();
      expect(mod.parseUpdateOperationSsePayload('string')).toBeUndefined();
      expect(mod.parseUpdateOperationSsePayload(42)).toBeUndefined();
    });

    it('returns undefined when status is not a recognised operation status', async () => {
      const mod = await loadModule();
      expect(mod.parseUpdateOperationSsePayload({ status: 'bogus' })).toBeUndefined();
      expect(mod.parseUpdateOperationSsePayload({})).toBeUndefined();
    });

    it('normalises a well-formed payload and keeps phase untouched', async () => {
      const mod = await loadModule();
      const parsed = mod.parseUpdateOperationSsePayload({
        operationId: 'op-1',
        containerId: 'c-1',
        newContainerId: 'c-2',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      expect(parsed).toEqual({
        operationId: 'op-1',
        containerId: 'c-1',
        newContainerId: 'c-2',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
    });

    it('drops non-string target fields so downstream consumers only see strings', async () => {
      const mod = await loadModule();
      const parsed = mod.parseUpdateOperationSsePayload({
        operationId: 42,
        containerId: null,
        newContainerId: undefined,
        containerName: {},
        status: 'queued',
      });
      expect(parsed).toEqual({
        operationId: undefined,
        containerId: undefined,
        newContainerId: undefined,
        containerName: undefined,
        status: 'queued',
        phase: undefined,
      });
    });

    it('forwards string lastError and rollbackReason when present', async () => {
      const mod = await loadModule();
      const parsed = mod.parseUpdateOperationSsePayload({
        operationId: 'op-1',
        containerName: 'web',
        status: 'rolled-back',
        lastError: 'Cancelled by operator',
        rollbackReason: 'cancelled',
      });
      expect(parsed?.lastError).toBe('Cancelled by operator');
      expect(parsed?.rollbackReason).toBe('cancelled');
    });

    it('drops non-string lastError and rollbackReason', async () => {
      const mod = await loadModule();
      const parsed = mod.parseUpdateOperationSsePayload({
        containerName: 'web',
        status: 'failed',
        lastError: 42,
        rollbackReason: null,
      });
      expect(parsed?.lastError).toBeUndefined();
      expect(parsed?.rollbackReason).toBeUndefined();
    });
  });

  describe('applyUpdateOperationSseToHold', () => {
    it('creates a hold with sortSnapshot on active-status events', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const container = makeContainer({
        id: 'c-active',
        name: 'web',
        updateDetectedAt: '2026-04-01T00:00:00.000Z',
      });
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-active',
          containerId: 'c-active',
          containerName: 'web',
          status: 'in-progress',
          phase: 'pulling',
        },
        resolveContainer: () => container,
      });
      const hold = heldOperations.value.get('op-active');
      expect(hold?.sortSnapshot?.updateDetectedAt).toBe('2026-04-01T00:00:00.000Z');
      expect(hold?.operation.status).toBe('in-progress');
      expect(hold?.operation.phase).toBe('pulling');
    });

    it('invokes onActiveOperationComputed so views can mirror row state', async () => {
      const mod = await loadModule();
      const container = makeContainer({ id: 'c-a', name: 'api' });
      const onActiveOperationComputed = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-a',
          containerId: 'c-a',
          containerName: 'api',
          status: 'queued',
          phase: 'queued',
        },
        resolveContainer: () => container,
        onActiveOperationComputed,
      });
      expect(onActiveOperationComputed).toHaveBeenCalledWith({
        operationId: 'op-a',
        container,
        nextOperation: expect.objectContaining({
          id: 'op-a',
          status: 'queued',
          phase: 'queued',
        }),
      });
    });

    it('short-circuits active-status events when the container cannot be resolved', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const onActiveOperationComputed = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-gone',
          containerId: 'ghost',
          status: 'in-progress',
          phase: 'pulling',
        },
        resolveContainer: () => undefined,
        onActiveOperationComputed,
      });
      expect(onActiveOperationComputed).not.toHaveBeenCalled();
      expect(heldOperations.value.has('op-gone')).toBe(false);
    });

    it('does not create a hold on active status when operationId is missing', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-noid', name: 'worker' });
      const onActiveOperationComputed = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          containerId: 'c-noid',
          containerName: 'worker',
          status: 'queued',
          phase: 'queued',
        },
        resolveContainer: () => container,
        onActiveOperationComputed,
      });
      expect(heldOperations.value.size).toBe(0);
      expect(onActiveOperationComputed).not.toHaveBeenCalled();
    });

    it('falls back to a status-appropriate phase when the payload phase is invalid', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-phase', name: 'svc' });
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-phase',
          containerId: 'c-phase',
          containerName: 'svc',
          status: 'in-progress',
          phase: 'nonsense',
        },
        resolveContainer: () => container,
      });
      expect(heldOperations.value.get('op-phase')?.operation.phase).toBe('pulling');
    });

    it('preserves the previous phase when the payload phase is invalid', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const container = makeContainer({
        id: 'c-prev',
        name: 'svc2',
        updateOperation: makeOperation({ id: 'op-prev', phase: 'health-gate' }),
      });
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-prev',
          containerId: 'c-prev',
          containerName: 'svc2',
          status: 'in-progress',
          phase: undefined,
        },
        resolveContainer: () => container,
      });
      expect(heldOperations.value.get('op-prev')?.operation.phase).toBe('health-gate');
    });

    it('falls back to queued when status=queued and no valid phase', async () => {
      const mod = await loadModule();
      const { heldOperations } = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-q', name: 'q' });
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-q',
          containerId: 'c-q',
          containerName: 'q',
          status: 'queued',
          phase: undefined,
        },
        resolveContainer: () => container,
      });
      expect(heldOperations.value.get('op-q')?.operation.phase).toBe('queued');
    });

    it('keeps a valid previous container operation id when the payload omits operationId', async () => {
      const mod = await loadModule();
      const container = makeContainer({
        id: 'c-noid2',
        name: 'svc3',
        updateOperation: makeOperation({ id: 'op-existing', phase: 'pulling' }),
      });
      const onActiveOperationComputed = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          containerId: 'c-noid2',
          containerName: 'svc3',
          status: 'in-progress',
          phase: 'pulling',
        },
        resolveContainer: () => container,
        onActiveOperationComputed,
      });
      // onActiveOperationComputed isn't called because there's no operationId,
      // but the early return happens AFTER we compute nextOperation — so no hold
      // is created and no callback fires.
      expect(onActiveOperationComputed).not.toHaveBeenCalled();
    });

    it('fires onTerminalEvent immediately for a tracked hold (state mutations must be synchronous)', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-t', name: 'tracked' });
      // Seed an active hold so the terminal is "tracked"
      composable.holdOperationDisplay({
        operationId: 'op-terminal',
        operation: makeOperation({ id: 'op-terminal' }),
        containerId: 'c-t',
        containerName: 'tracked',
      });
      const onTerminalEvent = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-terminal',
          containerId: 'c-t',
          containerName: 'tracked',
          status: 'succeeded',
        },
        resolveContainer: () => container,
        onTerminalEvent,
      });
      // onTerminalEvent fires immediately (state mutations need synchronous access to container)
      expect(onTerminalEvent).toHaveBeenCalledOnce();
      expect(onTerminalEvent).toHaveBeenCalledWith({
        container,
        status: 'succeeded',
        name: 'tracked',
        operationId: 'op-terminal',
      });
      // Hold is still in the settle window (row not yet cleared)
      expect(composable.findMatchingOperationIds({ operationId: 'op-terminal' })).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1500);
      // Hold clears after the settle window
      expect(composable.findMatchingOperationIds({ operationId: 'op-terminal' })).toHaveLength(0);
    });

    it('fires onHoldReleased AFTER the settle timer for a tracked hold (toasts must be deferred)', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-hr', name: 'hold-released' });
      composable.holdOperationDisplay({
        operationId: 'op-hr',
        operation: makeOperation({ id: 'op-hr' }),
        containerId: 'c-hr',
        containerName: 'hold-released',
      });
      const onHoldReleased = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-hr',
          containerId: 'c-hr',
          containerName: 'hold-released',
          status: 'succeeded',
        },
        resolveContainer: () => container,
        onHoldReleased,
      });
      // Not yet — row is in its settle window
      expect(onHoldReleased).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1499);
      expect(onHoldReleased).not.toHaveBeenCalled();

      // Timer fires: hold removed, THEN onHoldReleased fires
      await vi.advanceTimersByTimeAsync(1);
      expect(onHoldReleased).toHaveBeenCalledOnce();
      expect(onHoldReleased).toHaveBeenCalledWith({
        container,
        status: 'succeeded',
        name: 'hold-released',
        operationId: 'op-hr',
      });
      expect(composable.findMatchingOperationIds({ operationId: 'op-hr' })).toHaveLength(0);
    });

    it('does NOT fire onHoldReleased if the hold release timer is cancelled before it fires', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-cancel', name: 'cancellable' });
      composable.holdOperationDisplay({
        operationId: 'op-cancel',
        operation: makeOperation({ id: 'op-cancel' }),
        containerId: 'c-cancel',
        containerName: 'cancellable',
      });
      const onHoldReleased = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-cancel',
          containerId: 'c-cancel',
          containerName: 'cancellable',
          status: 'succeeded',
        },
        resolveContainer: () => container,
        onHoldReleased,
      });
      // Hold is scheduled for release; onHoldReleased not yet fired
      expect(onHoldReleased).not.toHaveBeenCalled();

      // Cancel the hold (e.g. a follow-up event re-asserts the operation)
      composable.clearHeldOperation({ operationId: 'op-cancel' });

      // Advance past the settle window — timer was cancelled so onComplete never runs
      await vi.advanceTimersByTimeAsync(2000);
      expect(onHoldReleased).not.toHaveBeenCalled();
    });

    it('does NOT fire onHoldReleased when no hold was active (no row release to wait for)', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const onHoldReleased = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-untracked-hr',
          containerId: 'c-u',
          containerName: 'untracked',
          status: 'failed',
        },
        resolveContainer: () => undefined,
        onHoldReleased,
      });
      // No hold was active — onHoldReleased should NOT fire since there is no row to release
      await vi.advanceTimersByTimeAsync(2000);
      expect(onHoldReleased).not.toHaveBeenCalled();
      expect(composable.findMatchingOperationIds({ operationId: 'op-untracked-hr' })).toHaveLength(
        0,
      );
    });

    it('fires onTerminalEvent when no hold was active', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const onTerminalEvent = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-untracked',
          containerId: 'c-u',
          containerName: 'untracked',
          status: 'failed',
        },
        resolveContainer: () => undefined,
        onTerminalEvent,
      });
      // onTerminalEvent fires immediately whether or not a hold was tracked
      expect(onTerminalEvent).toHaveBeenCalledWith({
        container: undefined,
        status: 'failed',
        name: 'untracked',
        operationId: 'op-untracked',
      });
      expect(composable.findMatchingOperationIds({ operationId: 'op-untracked' })).toHaveLength(0);
    });

    it('uses the resolved container name over the payload name when both exist', async () => {
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      const container = makeContainer({ id: 'c-n', name: 'canonical' });
      composable.holdOperationDisplay({
        operationId: 'op-n',
        operation: makeOperation({ id: 'op-n' }),
        containerId: 'c-n',
        containerName: 'canonical',
      });
      const onTerminalEvent = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-n',
          containerId: 'c-n',
          containerName: 'stale-payload-name',
          status: 'rolled-back',
        },
        resolveContainer: () => container,
        onTerminalEvent,
      });
      // onTerminalEvent fires immediately — name should be from container, not payload
      expect(onTerminalEvent.mock.calls[0]?.[0]?.name).toBe('canonical');
    });

    it('falls back to "container" when neither container nor payload provide a name', async () => {
      const mod = await loadModule();
      const onTerminalEvent = vi.fn();
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-nameless',
          status: 'failed',
        },
        resolveContainer: () => undefined,
        onTerminalEvent,
      });
      expect(onTerminalEvent.mock.calls[0]?.[0]?.name).toBe('container');
    });

    it('clears the held operation when status is neither active nor terminal', async () => {
      // The status enum only contains active + terminal values today, but the
      // helper's branch covers defensive handling of unexpected statuses; we
      // exercise that branch by asserting clearHeldOperation's side effect via
      // an explicit fake status cast.
      const mod = await loadModule();
      const composable = mod.useOperationDisplayHold();
      composable.holdOperationDisplay({
        operationId: 'op-unknown',
        operation: makeOperation({ id: 'op-unknown' }),
        containerId: 'c-x',
        containerName: 'x',
      });
      expect(composable.heldOperations.value.has('op-unknown')).toBe(true);
      mod.applyUpdateOperationSseToHold({
        parsed: {
          operationId: 'op-unknown',
          containerId: 'c-x',
          containerName: 'x',
          // Non-standard status to hit the default branch
          status: 'unknown' as unknown as 'succeeded',
        },
        resolveContainer: () => undefined,
      });
      expect(composable.heldOperations.value.has('op-unknown')).toBe(false);
    });
  });
});
