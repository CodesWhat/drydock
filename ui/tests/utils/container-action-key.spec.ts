import type { ContainerActionKind } from '../../src/utils/container-action-key';
import {
  getContainerActionIdentityKey,
  getContainerActionKey,
  getTrackedContainerActionKind,
  hasTrackedContainerAction,
  hasTrackedContainerActionOfKind,
} from '../../src/utils/container-action-key';

function makeTracked(entries: [string, ContainerActionKind][]): Map<string, ContainerActionKind> {
  return new Map(entries);
}

describe('getContainerActionKey', () => {
  test('prefers id over name', () => {
    expect(getContainerActionKey({ id: 'abc123', name: 'web' })).toBe('abc123');
  });

  test('falls back to name when id is missing', () => {
    expect(getContainerActionKey({ name: 'web' })).toBe('web');
  });

  test('falls back to name when id is empty string', () => {
    expect(getContainerActionKey({ id: '', name: 'web' })).toBe('web');
  });

  test('falls back to name when id is whitespace', () => {
    expect(getContainerActionKey({ id: '  ', name: 'web' })).toBe('web');
  });

  test('returns empty string when both are missing', () => {
    expect(getContainerActionKey({})).toBe('');
  });

  test('returns id even when name is also valid', () => {
    expect(getContainerActionKey({ id: 'host1-abc', name: 'portainer_agent' })).toBe('host1-abc');
  });
});

describe('getTrackedContainerActionKind', () => {
  test('returns the kind for a container matched by id', () => {
    const tracked = makeTracked([['abc123', 'update']]);
    expect(getTrackedContainerActionKind(tracked, { id: 'abc123', name: 'web' })).toBe('update');
  });

  test('returns the kind for a container matched by name when id is not tracked', () => {
    const tracked = makeTracked([['web', 'scan']]);
    expect(getTrackedContainerActionKind(tracked, { id: 'abc123', name: 'web' })).toBe('scan');
  });

  test('prefers id over name when both are tracked', () => {
    const tracked = makeTracked([
      ['abc123', 'update'],
      ['web', 'scan'],
    ]);
    expect(getTrackedContainerActionKind(tracked, { id: 'abc123', name: 'web' })).toBe('update');
  });

  test('returns undefined when neither id nor name is tracked', () => {
    const tracked = makeTracked([['other', 'lifecycle']]);
    expect(getTrackedContainerActionKind(tracked, { id: 'abc123', name: 'web' })).toBeUndefined();
  });

  test('returns undefined for an empty map', () => {
    const tracked = makeTracked([]);
    expect(getTrackedContainerActionKind(tracked, { id: 'abc123', name: 'web' })).toBeUndefined();
  });

  test('returns undefined when container has no id or name', () => {
    const tracked = makeTracked([['abc123', 'update']]);
    expect(getTrackedContainerActionKind(tracked, {})).toBeUndefined();
  });
});

describe('hasTrackedContainerAction', () => {
  test('matches by id', () => {
    const tracked = makeTracked([['abc123', 'update']]);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(true);
  });

  test('matches by name', () => {
    const tracked = makeTracked([['web', 'scan']]);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(true);
  });

  test('does not match when neither id nor name is tracked', () => {
    const tracked = makeTracked([['other', 'lifecycle']]);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(false);
  });

  test('same-named containers with different IDs are distinguished when tracked by ID', () => {
    const tracked = makeTracked([['host1-abc', 'update']]);
    expect(hasTrackedContainerAction(tracked, { id: 'host1-abc', name: 'portainer_agent' })).toBe(
      true,
    );
    expect(hasTrackedContainerAction(tracked, { id: 'host2-def', name: 'portainer_agent' })).toBe(
      false,
    );
  });
});

describe('hasTrackedContainerActionOfKind', () => {
  test('returns true when the tracked kind matches', () => {
    const tracked = makeTracked([['abc123', 'scan']]);
    expect(hasTrackedContainerActionOfKind(tracked, { id: 'abc123', name: 'web' }, 'scan')).toBe(
      true,
    );
  });

  test('returns false when the tracked kind differs', () => {
    const tracked = makeTracked([['abc123', 'update']]);
    expect(hasTrackedContainerActionOfKind(tracked, { id: 'abc123', name: 'web' }, 'scan')).toBe(
      false,
    );
  });

  test('returns false when the container is not tracked at all', () => {
    const tracked = makeTracked([['other', 'scan']]);
    expect(hasTrackedContainerActionOfKind(tracked, { id: 'abc123', name: 'web' }, 'scan')).toBe(
      false,
    );
  });

  test('distinguishes all four action kinds', () => {
    const kinds: ContainerActionKind[] = ['update', 'scan', 'lifecycle', 'delete'];
    for (const kind of kinds) {
      const tracked = makeTracked([['abc123', kind]]);
      expect(hasTrackedContainerActionOfKind(tracked, { id: 'abc123' }, kind)).toBe(true);
      for (const otherKind of kinds) {
        if (otherKind !== kind) {
          expect(hasTrackedContainerActionOfKind(tracked, { id: 'abc123' }, otherKind)).toBe(false);
        }
      }
    }
  });
});

describe('getContainerActionIdentityKey', () => {
  test('prefers an explicit identity key so replacement containers keep the same identity', () => {
    expect(
      getContainerActionIdentityKey({
        identityKey: 'edge-a::docker-prod::portainer_agent',
        id: 'host1-abc',
        name: 'portainer_agent',
      }),
    ).toBe('edge-a::docker-prod::portainer_agent');
  });

  test('builds the canonical agent watcher identity when raw identity fields are available', () => {
    expect(
      getContainerActionIdentityKey({
        name: 'portainer_agent',
        watcher: 'docker-prod',
        agent: 'edge-a',
      }),
    ).toBe('edge-a::docker-prod::portainer_agent');
  });

  test('falls back to the action key when logical identity fields are unavailable', () => {
    expect(
      getContainerActionIdentityKey({
        id: 'host1-abc',
        name: 'portainer_agent',
      }),
    ).toBe('host1-abc');
  });
});
