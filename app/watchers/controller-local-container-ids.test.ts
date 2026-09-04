import { describe, expect, test, vi } from 'vitest';
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
    test('records the ids a one-off listContainers() call returns', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }, { Id: 'b' }]),
      };

      await seedControllerLocalEnumeration(watcher('docker.local'), dockerApi);

      expect(dockerApi.listContainers).toHaveBeenCalledWith({ all: true });
      expect(findControllerLocalWatcherClaimingContainerId('b')).toBe('docker.local');
    });

    test('records nothing for a watcher owned by an agent', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }]),
      };

      await seedControllerLocalEnumeration(watcher('remote1.docker.local', 'remote1'), dockerApi);

      expect(findControllerLocalWatcherClaimingContainerId('a')).toBeUndefined();
    });

    test('swallows a listContainers() failure and warns via the logger', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockRejectedValue(new Error('daemon unreachable')),
      };
      const logger = { warn: vi.fn() };

      await expect(
        seedControllerLocalEnumeration(watcher('docker.local'), dockerApi, logger),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('daemon unreachable'));
      expect(findControllerLocalWatcherClaimingContainerId('anything')).toBeUndefined();
    });

    test('swallows a listContainers() failure silently with no logger given', async () => {
      const dockerApi = {
        listContainers: vi.fn().mockRejectedValue('not an Error instance'),
      };

      await expect(
        seedControllerLocalEnumeration(watcher('docker.local'), dockerApi),
      ).resolves.toBeUndefined();
    });

    test('a never-settling listContainers resolves the seed after advancing the clock, with the warn and no recorded ids', async () => {
      vi.useFakeTimers();
      try {
        const dockerApi = {
          listContainers: vi.fn().mockReturnValue(new Promise(() => undefined)),
        };
        const logger = { warn: vi.fn() };

        const seedPromise = seedControllerLocalEnumeration(
          watcher('docker.local'),
          dockerApi,
          logger,
        );
        await vi.advanceTimersByTimeAsync(CONTROLLER_LOCAL_SEED_TIMEOUT_MS);
        await expect(seedPromise).resolves.toBeUndefined();

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`timed out after ${CONTROLLER_LOCAL_SEED_TIMEOUT_MS}ms`),
        );
        expect(findControllerLocalWatcherClaimingContainerId('anything')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('a late resolution after the timeout does not record either', async () => {
      vi.useFakeTimers();
      try {
        let resolveListContainers: (value: Array<{ Id: string }>) => void = () => undefined;
        const pendingListContainers = new Promise<Array<{ Id: string }>>((resolve) => {
          resolveListContainers = resolve;
        });
        const dockerApi = {
          listContainers: vi.fn().mockReturnValue(pendingListContainers),
        };
        const logger = { warn: vi.fn() };

        const seedPromise = seedControllerLocalEnumeration(
          watcher('docker.local'),
          dockerApi,
          logger,
        );
        await vi.advanceTimersByTimeAsync(CONTROLLER_LOCAL_SEED_TIMEOUT_MS);
        await seedPromise;

        resolveListContainers([{ Id: 'late-id' }]);
        // Let the now-settled listContainers() promise's continuation, if any
        // ever ran, drain before asserting nothing recorded it.
        await Promise.resolve();
        await Promise.resolve();

        expect(findControllerLocalWatcherClaimingContainerId('late-id')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('a normal resolution clears the timer (no open handle)', async () => {
      vi.useFakeTimers();
      try {
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
        const dockerApi = {
          listContainers: vi.fn().mockResolvedValue([{ Id: 'a' }]),
        };

        await seedControllerLocalEnumeration(watcher('docker.local'), dockerApi);

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(findControllerLocalWatcherClaimingContainerId('a')).toBe('docker.local');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
