import type { CleanupDockerApi, CleanupHost, CleanupPolicy } from './types.js';

export const NOW = Date.parse('2026-11-18T12:00:00.000Z');
export const HOUR = 3_600_000;

export function makePolicy(overrides: Partial<CleanupPolicy> = {}): CleanupPolicy {
  return {
    name: 'nightly',
    cron: '0 3 * * *',
    checkCron: '*/15 * * * *',
    hosts: [],
    types: {
      danglingImages: false,
      unusedImages: false,
      stoppedContainers: false,
      networks: false,
      buildCache: false,
      volumes: false,
      ...overrides.types,
    },
    unusedImagesOlderThanHours: 0,
    protectHours: 168,
    dryRun: false,
    ...overrides,
    ...(overrides.types
      ? {
          types: {
            danglingImages: false,
            unusedImages: false,
            stoppedContainers: false,
            networks: false,
            buildCache: false,
            volumes: false,
            ...overrides.types,
          },
        }
      : {}),
  };
}

export function makeApi(overrides: Partial<Record<keyof CleanupDockerApi, unknown>> = {}) {
  const imageRemove = vi.fn().mockResolvedValue(undefined);
  const containerRemove = vi.fn().mockResolvedValue(undefined);
  const volumeRemove = vi.fn().mockResolvedValue(undefined);
  const api = {
    listImages: vi.fn().mockResolvedValue([]),
    listContainers: vi.fn().mockResolvedValue([]),
    listNetworks: vi.fn().mockResolvedValue([]),
    getImage: vi.fn(() => ({ remove: imageRemove })),
    getContainer: vi.fn(() => ({ remove: containerRemove })),
    getVolume: vi.fn(() => ({ remove: volumeRemove })),
    pruneNetworks: vi.fn().mockResolvedValue({ NetworksDeleted: [] }),
    pruneBuilder: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
    df: vi.fn().mockResolvedValue({}),
    pruneImages: vi.fn(),
    ...overrides,
  };
  return {
    api: api as unknown as CleanupDockerApi,
    mocks: api,
    imageRemove,
    containerRemove,
    volumeRemove,
  };
}

export function makeHost(api: CleanupDockerApi, overrides: Partial<CleanupHost> = {}): CleanupHost {
  return { id: 'docker.local', name: 'local', api, ...overrides };
}
