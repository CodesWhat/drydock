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
});
