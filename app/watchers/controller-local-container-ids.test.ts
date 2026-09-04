import { describe, expect, test } from 'vitest';
import {
  _resetControllerLocalContainerIdsForTests,
  findControllerLocalWatcherClaimingContainerId,
  forgetControllerLocalEnumeration,
  recordControllerLocalEnumeration,
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
});
