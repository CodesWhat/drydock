import { describe, expect, test, vi } from 'vitest';

import {
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
    const inspectContainer = vi.fn().mockResolvedValue({ State: { Status: 'running' } });
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
});
