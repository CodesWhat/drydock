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

  it('refreshes the same operation without dropping its existing hold', async () => {
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
    expect(refreshed?.displayUntil).toBe(firstDisplayUntil);
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

    expect(hold.heldOperations.value.get(unnamed.id)?.displayUntil).toBe(Date.now() + 1500);

    hold.clearHeldOperation({ containerId: 'container-only' });
    expect(hold.heldOperations.value.has(unnamed.id)).toBe(false);
  });

  it('schedules release for active holds and removes expired holds immediately', async () => {
    const hold = await loadComposable();
    const active = makeOperation({ id: 'op-active' });
    const expired = makeOperation({ id: 'op-expired' });

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
      }),
    );

    await vi.advanceTimersByTimeAsync(1499);
    expect(hold.getDisplayUpdateOperation('web-renamed')).toEqual(active);
    expect(hold.heldOperations.value.has(active.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(hold.getDisplayUpdateOperation('web-renamed')).toBeUndefined();

    hold.holdOperationDisplay({
      operationId: expired.id,
      operation: expired,
      containerId: 'container-expired',
      containerName: 'expired',
      now: Date.now(),
    });

    expect(
      hold.scheduleHeldOperationRelease({
        operationId: expired.id,
        containerId: 'container-expired',
        now: Date.now() + 5000,
      }),
    ).toBe(false);
    expect(hold.heldOperations.value.has(expired.id)).toBe(false);
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

  it('projects container display state without cloning when no held update applies', async () => {
    const hold = await loadComposable();
    const updateOperation = makeOperation({ id: 'op-base' });
    const container = makeContainer({ updateOperation });

    expect(hold.projectContainerDisplayState(container)).toBe(container);

    const sameHeld = makeOperation({ id: 'op-same' });
    hold.holdOperationDisplay({
      operationId: sameHeld.id,
      operation: sameHeld,
      containerId: container.id,
      containerName: container.name,
      now: Date.now(),
    });

    const heldOperation = hold.getDisplayUpdateOperation(container);
    const sameContainer = makeContainer({
      id: 'container-2',
      identityKey: 'container-2',
      name: 'api',
      updateOperation: heldOperation,
    });

    expect(hold.projectContainerDisplayState(sameContainer)).toBe(sameContainer);
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
});
