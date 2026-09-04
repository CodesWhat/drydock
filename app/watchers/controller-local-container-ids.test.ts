import { describe, expect, test } from 'vitest';
import {
  _resetControllerLocalContainerIdsForTests,
  CONTROLLER_LOCAL_SEED_TIMEOUT_MS,
  findControllerLocalWatcherClaimingContainerId,
  forgetControllerLocalEnumeration,
  recordControllerLocalEnumeration,
  seedControllerLocalEnumeration,
} from './controller-local-container-ids.js';

const watcher = (id: string, agent?: string) => ({ getId: () => id, agent });

describe('controller-local-container-ids', () => {
  beforeEach(() => {
    _resetControllerLocalContainerIdsForTests();
  });

  test('reports the watcher currently enumerating an id', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), ['a', 'b']);

    expect(findControllerLocalWatcherClaimingContainerId('b')).toBe('docker.local');
  });

  test('returns undefined for an id no controller-local watcher enumerates', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), ['a']);

    expect(findControllerLocalWatcherClaimingContainerId('missing')).toBeUndefined();
  });

  test('searches every registered watcher, not just the first', () => {
    recordControllerLocalEnumeration(watcher('docker.first'), ['a']);
    recordControllerLocalEnumeration(watcher('docker.second'), ['b']);

    expect(findControllerLocalWatcherClaimingContainerId('b')).toBe('docker.second');
  });

  test('replaces the whole set on each enumeration so removed containers drop out', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), ['a', 'b']);
    recordControllerLocalEnumeration(watcher('docker.local'), ['b']);

    expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
    expect(findControllerLocalWatcherClaimingContainerId('b')).toBe('docker.local');
  });

  test('skips ids that are not non-empty strings', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), [
      'a',
      '',
      undefined,
      42 as unknown as string,
    ]);

    expect(findControllerLocalWatcherClaimingContainerId('')).toBeUndefined();
    expect(findControllerLocalWatcherClaimingContainerId('42')).toBeUndefined();
    expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
  });

  test('records nothing for a watcher owned by an agent', () => {
    // A DD_AGENT_* controller-Docker-transport watcher runs in the controller
    // process but enumerates the agent's daemon, so its ids are the agent's.
    recordControllerLocalEnumeration(watcher('remote1.docker.local', 'remote1'), ['a']);

    expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
  });

  test('treats an empty agent string as controller-local', () => {
    recordControllerLocalEnumeration(watcher('docker.local', ''), ['a']);

    expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
  });

  test('clearing a watcher drops the ids it was claiming', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), ['a']);
    forgetControllerLocalEnumeration(watcher('docker.local'));

    expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
  });

  test('clearing an unknown watcher is a no-op', () => {
    recordControllerLocalEnumeration(watcher('docker.local'), ['a']);
    forgetControllerLocalEnumeration(watcher('docker.never-registered'));

    expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
  });

  describe('seedControllerLocalEnumeration', () => {
    test('records the ids a one-shot listContainers call returns', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }, { Id: 'b' }]),
      };

      await seedControllerLocalEnumeration(watcher('docker.local'), dockerApi);

      expect(dockerApi.listContainers).toHaveBeenCalledWith({ all: true });
      expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
      expect(findControllerLocalWatcherClaimingContainerId('b')).toBe('docker.local');
    });

    test('does not call listContainers for a watcher owned by an agent', async () => {
      const dockerApi = { listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }]) };

      await seedControllerLocalEnumeration(watcher('remote1.docker.local', 'remote1'), dockerApi);

      expect(dockerApi.listContainers).not.toHaveBeenCalled();
      expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
    });

    test('swallows a failed listContainers call and warns instead of throwing', async () => {
      const warn = vi.fn();
      const dockerApi = {
        listContainers: vi.fn().mockRejectedValue(new Error('daemon unreachable')),
      };

      await expect(
        seedControllerLocalEnumeration({ getId: () => 'docker.local', log: { warn } }, dockerApi),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('daemon unreachable'));
      expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
    });

    test('swallows a failed listContainers call when the watcher has no logger', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockRejectedValue(new Error('daemon unreachable')),
      };

      await expect(
        seedControllerLocalEnumeration(watcher('docker.local'), dockerApi),
      ).resolves.toBeUndefined();
    });

    test('gives up and warns once a never-settling listContainers call outlasts the timeout', async () => {
      vi.useFakeTimers();
      try {
        const warn = vi.fn();
        const dockerApi = {
          // Never resolves or rejects - simulates a stalled daemon.
          listContainers: vi.fn(() => new Promise<Array<{ Id?: string }>>(() => undefined)),
        };

        const seedPromise = seedControllerLocalEnumeration(
          { getId: () => 'docker.local', log: { warn } },
          dockerApi,
        );

        await vi.advanceTimersByTimeAsync(CONTROLLER_LOCAL_SEED_TIMEOUT_MS);
        await expect(seedPromise).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `Controller-local container id seed timed out after ${CONTROLLER_LOCAL_SEED_TIMEOUT_MS}ms`,
          ),
        );
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('agent ownership checks start permissive until the first scan'),
        );
        expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('ignores a listContainers resolution that arrives after the seed already timed out', async () => {
      vi.useFakeTimers();
      try {
        let resolveListContainers: (containers: Array<{ Id?: string }>) => void = () => undefined;
        const dockerApi = {
          listContainers: vi.fn(
            () =>
              new Promise<Array<{ Id?: string }>>((resolve) => {
                resolveListContainers = resolve;
              }),
          ),
        };

        const seedPromise = seedControllerLocalEnumeration(watcher('docker.local'), dockerApi);

        await vi.advanceTimersByTimeAsync(CONTROLLER_LOCAL_SEED_TIMEOUT_MS);
        await seedPromise;

        // The daemon finally answers, well after the seed already gave up.
        resolveListContainers([{ Id: 'a' }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('clears the timeout on a normal resolution so no timer is left pending', async () => {
      vi.useFakeTimers();
      try {
        const dockerApi = {
          listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }]),
        };

        await seedControllerLocalEnumeration(watcher('docker.local'), dockerApi);

        expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
