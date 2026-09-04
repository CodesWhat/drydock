import { describe, expect, test, vi } from 'vitest';
import {
  _resetControllerLocalContainerIdsForTests,
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
  });
});
