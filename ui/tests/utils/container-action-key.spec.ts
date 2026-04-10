import {
  getContainerActionIdentityKey,
  getContainerActionKey,
  hasTrackedContainerAction,
} from '../../src/utils/container-action-key';

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

describe('hasTrackedContainerAction', () => {
  test('matches by id', () => {
    const tracked = new Set(['abc123']);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(true);
  });

  test('matches by name', () => {
    const tracked = new Set(['web']);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(true);
  });

  test('does not match when neither id nor name is tracked', () => {
    const tracked = new Set(['other']);
    expect(hasTrackedContainerAction(tracked, { id: 'abc123', name: 'web' })).toBe(false);
  });

  test('same-named containers with different IDs are distinguished when tracked by ID', () => {
    const tracked = new Set(['host1-abc']);
    expect(hasTrackedContainerAction(tracked, { id: 'host1-abc', name: 'portainer_agent' })).toBe(
      true,
    );
    expect(hasTrackedContainerAction(tracked, { id: 'host2-def', name: 'portainer_agent' })).toBe(
      false,
    );
  });
});

describe('getContainerActionIdentityKey', () => {
  test('uses server and name so replacement containers keep the same identity', () => {
    expect(
      getContainerActionIdentityKey({
        id: 'host1-abc',
        name: 'portainer_agent',
        server: 'Datavault',
      }),
    ).toBe('Datavault::portainer_agent');
  });

  test('falls back to the action key when server is unavailable', () => {
    expect(
      getContainerActionIdentityKey({
        id: 'host1-abc',
        name: 'portainer_agent',
      }),
    ).toBe('host1-abc');
  });
});
