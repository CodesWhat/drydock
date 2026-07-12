import { describe, expect, test, vi } from 'vitest';

import {
  isRecreatedContainerAlias,
  processDockerEvent,
  updateContainerFromInspect,
} from './container-event-update.js';

function createMockContainer(overrides: Record<string, any> = {}) {
  return {
    id: 'container123',
    name: 'old-name',
    displayName: 'old-name',
    status: 'stopped',
    image: { name: 'library/nginx' },
    labels: {},
    details: {
      state: {
        status: 'stopped',
      },
    },
    ...overrides,
  };
}

describe('container event update helpers', () => {
  describe('isRecreatedContainerAlias', () => {
    test('returns true when container name is a self-ID-prefixed alias', () => {
      expect(
        isRecreatedContainerAlias(
          '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
          '7ea6b8a42686_termix',
        ),
      ).toBe(true);
    });

    test('returns false when container name does not match alias pattern', () => {
      expect(isRecreatedContainerAlias('container123', 'my-app')).toBe(false);
    });

    test('returns false when hex prefix does not match container id', () => {
      expect(
        isRecreatedContainerAlias(
          'aaaaaaaaaaaa1111111111111111111111111111111111111111111111111111',
          '7ea6b8a42686_termix',
        ),
      ).toBe(false);
    });

    test('handles case-insensitive ID prefix matching', () => {
      expect(
        isRecreatedContainerAlias(
          '7EA6B8A42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
          '7ea6b8a42686_termix',
        ),
      ).toBe(true);
    });
  });

  test('processDockerEvent triggers cron debounce for create/destroy events', async () => {
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);

    await processDockerEvent(
      { Action: 'create', id: 'container123' },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn(),
        inspectContainer: vi.fn(),
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug: vi.fn(),
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
  });

  test('processDockerEvent inspects and applies updates for non-create/destroy actions', async () => {
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi
      .fn()
      .mockResolvedValue({ Name: '/my-app', State: { Status: 'running' } });
    const containerFound = createMockContainer();
    const getContainerFromStore = vi.fn().mockReturnValue(containerFound);
    const updateContainerFromInspectMock = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: 'container123' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: updateContainerFromInspectMock,
        debug: vi.fn(),
      },
    );

    expect(ensureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(inspectContainer).toHaveBeenCalledWith('container123');
    expect(getContainerFromStore).toHaveBeenCalledWith('container123');
    expect(updateContainerFromInspectMock).toHaveBeenCalledWith(
      containerFound,
      expect.objectContaining({ State: { Status: 'running' } }),
    );
  });

  test('processDockerEvent falls back to Actor.ID when top-level id is missing', async () => {
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi
      .fn()
      .mockResolvedValue({ Name: '/my-app', State: { Status: 'running' } });
    const containerFound = createMockContainer();
    const getContainerFromStore = vi.fn().mockReturnValue(containerFound);
    const updateContainerFromInspectMock = vi.fn();

    await processDockerEvent(
      { Action: 'start', Actor: { ID: 'container123' } },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: updateContainerFromInspectMock,
        debug: vi.fn(),
      },
    );

    expect(ensureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(inspectContainer).toHaveBeenCalledWith('container123');
    expect(getContainerFromStore).toHaveBeenCalledWith('container123');
    expect(updateContainerFromInspectMock).toHaveBeenCalledWith(
      containerFound,
      expect.objectContaining({ State: { Status: 'running' } }),
    );
  });

  test('processDockerEvent debounces a full refresh when event has no container id', async () => {
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start' },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn(),
        inspectContainer,
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(inspectContainer).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('container id is missing'));
  });

  test('processDockerEvent logs debug and swallows inspect failures', async () => {
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: 'missing' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockRejectedValue(new Error('No such container')),
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to get container details for container id=[missing]'),
    );
  });

  test('processDockerEvent schedules a debounced watch for rename events when container is not in store', async () => {
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);

    await processDockerEvent(
      { Action: 'rename', id: 'container123' },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockResolvedValue({
          Name: '/renamed-container',
          State: { Status: 'running' },
        }),
        getContainerFromStore: vi.fn().mockReturnValue(undefined),
        updateContainerFromInspect: vi.fn(),
        debug: vi.fn(),
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
  });

  test('processDockerEvent schedules a debounced watch for start events when container is not in store', async () => {
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);

    await processDockerEvent(
      { Action: 'start', id: 'new-container-456' },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockResolvedValue({
          Name: '/stirling-pdf',
          State: { Status: 'running' },
        }),
        getContainerFromStore: vi.fn().mockReturnValue(undefined),
        updateContainerFromInspect: vi.fn(),
        debug: vi.fn(),
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
  });

  test('processDockerEvent debounces refresh for transient recreated container alias after inspecting', async () => {
    const aliasContainerId = 'd6ea364fbc03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/d6ea364fbc03_termix',
      Created: new Date().toISOString(),
      State: { Status: 'running' },
    });
    const getContainerFromStore = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: aliasContainerId },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(ensureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(inspectContainer).toHaveBeenCalledWith(aliasContainerId);
    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(getContainerFromStore).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Skipping transient recreated container alias'),
    );
  });

  test('processDockerEvent treats seconds-based Created timestamp as transient alias', async () => {
    const aliasContainerId = 'd6ea364fbc03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/d6ea364fbc03_termix',
      Created: Math.floor(Date.now() / 1000),
      State: { Status: 'running' },
    });
    const getContainerFromStore = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: aliasContainerId },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(getContainerFromStore).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Skipping transient recreated container alias'),
    );
  });

  test('processDockerEvent falls back to State.StartedAt when Created is invalid', async () => {
    const aliasContainerId = 'd6ea364fbc03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/d6ea364fbc03_termix',
      Created: 'not-a-date',
      State: {
        Status: 'running',
        StartedAt: new Date().toISOString(),
      },
    });
    const getContainerFromStore = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: aliasContainerId },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(getContainerFromStore).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Skipping transient recreated container alias'),
    );
  });

  test('processDockerEvent schedules refresh for persistent recreated alias without mutating store records', async () => {
    const aliasContainerId = 'd6ea364fbc03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/d6ea364fbc03_termix',
      Created: new Date(Date.now() - 60 * 1000).toISOString(),
      State: { Status: 'running' },
    });
    const getContainerFromStore = vi.fn();
    const updateContainerFromInspectMock = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: aliasContainerId },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: updateContainerFromInspectMock,
        debug,
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(getContainerFromStore).not.toHaveBeenCalled();
    expect(updateContainerFromInspectMock).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('persisted beyond transient window'),
    );
  });

  test('processDockerEvent schedules refresh for alias when Created is in the future', async () => {
    const aliasContainerId = 'd6ea364fbc03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/d6ea364fbc03_termix',
      Created: Date.now() + 60 * 1000,
      State: { Status: 'running' },
    });
    const getContainerFromStore = vi.fn();
    const updateContainerFromInspectMock = vi.fn();
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: aliasContainerId },
      {
        watchCronDebounced,
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: updateContainerFromInspectMock,
        debug,
      },
    );

    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
    expect(getContainerFromStore).not.toHaveBeenCalled();
    expect(updateContainerFromInspectMock).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('persisted beyond transient window'),
    );
  });

  test('updateContainerFromInspect updates status/name/displayName and persists', () => {
    const container = createMockContainer({
      status: 'stopped',
      name: 'old-temp-name',
      displayName: 'old-temp-name',
    });
    const logInfo = vi.fn();
    const updateContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/renamed-container',
        State: { Status: 'running' },
        Config: { Labels: {} },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
        logInfo,
      },
    );

    expect(container.status).toBe('running');
    expect(container.name).toBe('renamed-container');
    expect(container.displayName).toBe('renamed-container');
    expect(logInfo).toHaveBeenCalledWith('Status changed from stopped to running');
    expect(logInfo).toHaveBeenCalledWith('Name changed from old-temp-name to renamed-container');
    expect(updateContainer).toHaveBeenCalledWith(container);
  });

  test('updateContainerFromInspect should canonicalize alias name from Docker inspect', () => {
    const container = createMockContainer({
      id: '8bf70beac570abcdef1234567890',
      name: 'termix',
    });
    const updateContainer = vi.fn();
    const logInfo = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/8bf70beac570_termix',
        State: { Status: 'running' },
        Config: { Labels: {} },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
        logInfo,
      },
    );

    // Name should remain canonical, not be overwritten with the alias
    expect(container.name).toBe('termix');
    expect(logInfo).not.toHaveBeenCalledWith(expect.stringContaining('Name changed'));
  });

  test('updateContainerFromInspect applies custom display name label', () => {
    const container = createMockContainer({
      displayName: 'old-name',
      name: 'old-name',
    });
    const updateContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/renamed-container',
        State: { Status: 'running' },
        Config: { Labels: { 'wud.display.name': 'Custom Label Name' } },
      },
      {
        getCustomDisplayNameFromLabels: () => 'Custom Label Name',
        updateContainer,
      },
    );

    expect(container.displayName).toBe('Custom Label Name');
    expect(updateContainer).toHaveBeenCalledWith(container);
  });

  test('updateContainerFromInspect skips persistence when tracked fields are unchanged', () => {
    const container = createMockContainer({
      name: 'same-name',
      displayName: 'custom-name',
      status: 'running',
      labels: { foo: 'bar' },
      details: {
        state: {
          status: 'running',
        },
      },
    });
    const updateContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/same-name',
        State: { Status: 'running' },
        Config: { Labels: { foo: 'bar' } },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
      },
    );

    expect(updateContainer).not.toHaveBeenCalled();
  });

  test('updateContainerFromInspect treats equivalent labels with different key order as unchanged', () => {
    const container = createMockContainer({
      name: 'same-name',
      displayName: 'custom-name',
      status: 'running',
      labels: { alpha: '1', beta: '2' },
      details: {
        state: {
          status: 'running',
        },
      },
    });
    const updateContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/same-name',
        State: { Status: 'running' },
        Config: { Labels: { beta: '2', alpha: '1' } },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
      },
    );

    expect(updateContainer).not.toHaveBeenCalled();
  });

  test.each([
    { previous: undefined, next: 'starting' },
    { previous: 'healthy', next: 'unhealthy' },
  ])('persists a health-only change from $previous to $next', ({ previous, next }) => {
    const found = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'running',
      health: previous,
    });
    const updateContainer = vi.fn();
    const logInfo = vi.fn();

    updateContainerFromInspect(
      found as any,
      { Name: '/same-name', State: { Status: 'running', Health: { Status: next } } },
      { getCustomDisplayNameFromLabels: () => undefined, updateContainer, logInfo },
    );

    expect(found.health).toBe(next);
    expect(updateContainer).toHaveBeenCalledWith(found);
    expect(logInfo).toHaveBeenCalledWith(`Health changed from ${previous} to ${next}`);
  });

  test('does not persist when unhealthy health is unchanged and nothing else changes', () => {
    const found = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'running',
      health: 'unhealthy',
    });
    const updateContainer = vi.fn();
    updateContainerFromInspect(
      found as any,
      { Name: '/same-name', State: { Status: 'running', Health: { Status: 'unhealthy' } } },
      { getCustomDisplayNameFromLabels: () => undefined, updateContainer },
    );
    expect(updateContainer).not.toHaveBeenCalled();
  });

  test('an inspect without State.Health leaves absent health unchanged', () => {
    const found = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'running',
    });
    const updateContainer = vi.fn();
    updateContainerFromInspect(
      found as any,
      { Name: '/same-name', State: { Status: 'running' } },
      { getCustomDisplayNameFromLabels: () => undefined, updateContainer },
    );
    expect(found.health).toBeUndefined();
    expect(updateContainer).not.toHaveBeenCalled();
  });

  test('an unknown inspect health normalizes to absent without marking an absent stored health changed', () => {
    const found = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'running',
      health: undefined,
    });
    const updateContainer = vi.fn();
    updateContainerFromInspect(
      found as any,
      { Name: '/same-name', State: { Status: 'running', Health: { Status: 'bogus' } } },
      { getCustomDisplayNameFromLabels: () => undefined, updateContainer },
    );
    expect(found.health).toBeUndefined();
    expect(updateContainer).not.toHaveBeenCalled();
  });

  test('updates both status and health in one inspect and persists once', () => {
    const found = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'stopped',
      health: 'healthy',
    });
    const updateContainer = vi.fn();
    updateContainerFromInspect(
      found as any,
      { Name: '/same-name', State: { Status: 'running', Health: { Status: 'unhealthy' } } },
      { getCustomDisplayNameFromLabels: () => undefined, updateContainer },
    );
    expect(found).toMatchObject({ status: 'running', health: 'unhealthy' });
    expect(updateContainer).toHaveBeenCalledTimes(1);
  });

  test('processDockerEvent includes string error message when inspect rejects with a string', async () => {
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: 'container123' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockRejectedValue('socket hung up'),
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('(socket hung up)'));
  });

  test('processDockerEvent reports unknown error when inspect rejects with null', async () => {
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: 'container123' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockRejectedValue(null),
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('(unknown error)'));
  });

  test('processDockerEvent reports unknown error when inspect rejects with object message that is not a string', async () => {
    const debug = vi.fn();

    await processDockerEvent(
      { Action: 'start', id: 'container123' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
        inspectContainer: vi.fn().mockRejectedValue({ message: { reason: 'bad' } }),
        getContainerFromStore: vi.fn(),
        updateContainerFromInspect: vi.fn(),
        debug,
      },
    );

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('(unknown error)'));
  });

  test('processDockerEvent treats non-object docker event as missing container id', async () => {
    const watchCronDebounced = vi.fn().mockResolvedValue(undefined);
    const debug = vi.fn();

    await processDockerEvent(null, {
      watchCronDebounced,
      ensureRemoteAuthHeaders: vi.fn(),
      inspectContainer: vi.fn(),
      getContainerFromStore: vi.fn(),
      updateContainerFromInspect: vi.fn(),
      debug,
    });

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('container id is missing'));
    expect(watchCronDebounced).toHaveBeenCalledTimes(1);
  });

  test('updateContainerFromInspect should persist when label values change', () => {
    const container = createMockContainer({
      name: 'same-name',
      displayName: 'same-name',
      status: 'running',
      labels: { alpha: '1', beta: '2' },
    });
    const updateContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/same-name',
        State: { Status: 'running' },
        Config: { Labels: { alpha: '1', beta: 'changed' } },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
      },
    );

    expect(container.labels).toEqual({ alpha: '1', beta: 'changed' });
    expect(updateContainer).toHaveBeenCalledWith(container);
  });

  test('updateContainerFromInspect calls applyDerivedLabelFieldsToContainer when labels change', () => {
    const container = createMockContainer({
      name: 'my-app',
      displayName: 'my-app',
      status: 'running',
      labels: {},
      tagFamily: undefined,
    });
    const updateContainer = vi.fn();
    const applyDerivedLabelFieldsToContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/my-app',
        State: { Status: 'running' },
        Config: { Labels: { 'dd.tag.family': 'loose' } },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
        applyDerivedLabelFieldsToContainer,
      },
    );

    expect(applyDerivedLabelFieldsToContainer).toHaveBeenCalledWith(container, {
      'dd.tag.family': 'loose',
    });
    expect(updateContainer).toHaveBeenCalledWith(container);
  });

  test('processDockerEvent re-derives label fields on die event when labels changed', async () => {
    const ensureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
    const inspectContainer = vi.fn().mockResolvedValue({
      Name: '/my-app',
      State: { Status: 'exited' },
      Config: { Labels: { 'dd.tag.include': '^2\\.', 'dd.tag.family': 'loose' } },
    });
    const container = createMockContainer({
      name: 'my-app',
      displayName: 'my-app',
      status: 'running',
      labels: { 'dd.tag.include': '^1\\.' },
      includeTags: '^1\\.',
      tagFamily: undefined,
    });
    const getContainerFromStore = vi.fn().mockReturnValue(container);
    const applyDerivedLabelFieldsToContainer = vi.fn((c, labels) => {
      c.includeTags = labels['dd.tag.include'];
      c.tagFamily = labels['dd.tag.family'];
    });
    const updateContainerMock = vi.fn();

    await processDockerEvent(
      { Action: 'die', id: 'container123' },
      {
        watchCronDebounced: vi.fn(),
        ensureRemoteAuthHeaders,
        inspectContainer,
        getContainerFromStore,
        updateContainerFromInspect: (found, inspected) =>
          updateContainerFromInspect(found, inspected, {
            getCustomDisplayNameFromLabels: () => undefined,
            updateContainer: updateContainerMock,
            applyDerivedLabelFieldsToContainer,
          }),
        debug: vi.fn(),
      },
    );

    expect(applyDerivedLabelFieldsToContainer).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ 'dd.tag.include': '^2\\.', 'dd.tag.family': 'loose' }),
    );
    expect(container.includeTags).toBe('^2\\.');
    expect(container.tagFamily).toBe('loose');
    expect(updateContainerMock).toHaveBeenCalledWith(container);
  });

  test('updateContainerFromInspect does not call applyDerivedLabelFieldsToContainer when labels are unchanged', () => {
    const container = createMockContainer({
      name: 'my-app',
      displayName: 'my-app',
      status: 'running',
      labels: { 'dd.tag.family': 'loose' },
    });
    const updateContainer = vi.fn();
    const applyDerivedLabelFieldsToContainer = vi.fn();

    updateContainerFromInspect(
      container as any,
      {
        Name: '/my-app',
        State: { Status: 'running' },
        Config: { Labels: { 'dd.tag.family': 'loose' } },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
        applyDerivedLabelFieldsToContainer,
      },
    );

    expect(applyDerivedLabelFieldsToContainer).not.toHaveBeenCalled();
    expect(updateContainer).not.toHaveBeenCalled();
  });

  test('updateContainerFromInspect works without applyDerivedLabelFieldsToContainer dependency (backward compat)', () => {
    const container = createMockContainer({
      name: 'my-app',
      displayName: 'my-app',
      status: 'running',
      labels: {},
    });
    const updateContainer = vi.fn();

    expect(() =>
      updateContainerFromInspect(
        container as any,
        {
          Name: '/my-app',
          State: { Status: 'running' },
          Config: { Labels: { 'dd.tag.family': 'loose' } },
        },
        {
          getCustomDisplayNameFromLabels: () => undefined,
          updateContainer,
          // applyDerivedLabelFieldsToContainer intentionally omitted
        },
      ),
    ).not.toThrow();

    expect(updateContainer).toHaveBeenCalledWith(container);
  });

  test('updateContainerFromInspect re-derives multiple label fields when labels change', () => {
    const container = createMockContainer({
      name: 'my-app',
      status: 'running',
      labels: { 'dd.tag.include': '^1\\.' },
      tagFamily: undefined,
      includeTags: '^1\\.',
      excludeTags: undefined,
    });
    const updateContainer = vi.fn();
    const applyDerivedLabelFieldsToContainer = vi.fn((c, labels) => {
      // Simulate what the real function does
      c.includeTags = labels['dd.tag.include'];
      c.excludeTags = labels['dd.tag.exclude'];
      c.tagFamily = labels['dd.tag.family'];
    });

    updateContainerFromInspect(
      container as any,
      {
        Name: '/my-app',
        State: { Status: 'running' },
        Config: {
          Labels: {
            'dd.tag.include': '^2\\.',
            'dd.tag.exclude': '^alpha',
            'dd.tag.family': 'loose',
          },
        },
      },
      {
        getCustomDisplayNameFromLabels: () => undefined,
        updateContainer,
        applyDerivedLabelFieldsToContainer,
      },
    );

    expect(container.includeTags).toBe('^2\\.');
    expect(container.excludeTags).toBe('^alpha');
    expect(container.tagFamily).toBe('loose');
    expect(updateContainer).toHaveBeenCalledWith(container);
  });
});
