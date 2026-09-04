import { describe, expect, test } from 'vitest';
import type { Container } from './container.js';
import {
  DEFAULT_MAINTENANCE_WINDOW_SCOPE,
  getContainerMaintenanceWindowOpen,
  getContainerMaintenanceWindowWatcher,
  MAINTENANCE_WINDOW_SCOPES,
  resolveMaintenanceWindowScope,
} from './watcher-maintenance-window.js';

type WindowContainer = Pick<Container, 'agent' | 'watcher'>;

const localContainer = { watcher: 'local' } as WindowContainer;

describe('model/watcher-maintenance-window scope vocabulary', () => {
  test('exports install and scan, with install as the default', () => {
    expect([...MAINTENANCE_WINDOW_SCOPES]).toEqual(['install', 'scan']);
    expect(DEFAULT_MAINTENANCE_WINDOW_SCOPE).toBe('install');
  });

  test('resolves the literal scan value and defaults everything else to install', () => {
    expect(resolveMaintenanceWindowScope('scan')).toBe('scan');
    expect(resolveMaintenanceWindowScope('install')).toBe('install');
    expect(resolveMaintenanceWindowScope(undefined)).toBe('install');
    expect(resolveMaintenanceWindowScope('Scan')).toBe('install');
    expect(resolveMaintenanceWindowScope(7)).toBe('install');
  });
});

describe('getContainerMaintenanceWindowWatcher', () => {
  test('resolves a controller-owned watcher by its docker.<name> id', () => {
    const watcher = { type: 'docker', name: 'local' };

    expect(getContainerMaintenanceWindowWatcher(localContainer, { 'docker.local': watcher })).toBe(
      watcher,
    );
  });

  test('prefixes the agent name, trimming surrounding whitespace on both parts', () => {
    const watcher = { type: 'docker', name: 'remote' };
    const container = { agent: ' edge ', watcher: ' remote ' } as WindowContainer;

    expect(getContainerMaintenanceWindowWatcher(container, { 'edge.docker.remote': watcher })).toBe(
      watcher,
    );
  });

  test('returns undefined when the container names no watcher', () => {
    expect(getContainerMaintenanceWindowWatcher({} as WindowContainer, {})).toBeUndefined();
    expect(
      getContainerMaintenanceWindowWatcher({ watcher: '   ' } as WindowContainer, {}),
    ).toBeUndefined();
  });

  test('returns undefined when the registry holds no entry, or no registry state at all', () => {
    expect(getContainerMaintenanceWindowWatcher(localContainer, {})).toBeUndefined();
    expect(getContainerMaintenanceWindowWatcher(localContainer, undefined)).toBeUndefined();
  });
});

describe('getContainerMaintenanceWindowOpen', () => {
  test('prefers the live isMaintenanceWindowOpen() reading', () => {
    expect(
      getContainerMaintenanceWindowOpen(localContainer, {
        'docker.local': {
          type: 'docker',
          name: 'local',
          isMaintenanceWindowOpen: () => false,
          configuration: { maintenancewindowopen: true },
        },
      }),
    ).toBe(false);
  });

  test('falls back to the masked configuration a remote agent reports', () => {
    expect(
      getContainerMaintenanceWindowOpen(localContainer, {
        'docker.local': {
          type: 'docker',
          name: 'local',
          configuration: { maintenancewindowopen: true },
        },
      }),
    ).toBe(true);
  });

  test('fails open as undefined when neither source is usable', () => {
    expect(getContainerMaintenanceWindowOpen(localContainer, {})).toBeUndefined();
    expect(
      getContainerMaintenanceWindowOpen(localContainer, {
        'docker.local': { type: 'docker', name: 'local' },
      }),
    ).toBeUndefined();
    expect(
      getContainerMaintenanceWindowOpen(localContainer, {
        'docker.local': {
          type: 'docker',
          name: 'local',
          configuration: { maintenancewindowopen: 'yes' },
        },
      }),
    ).toBeUndefined();
  });
});
