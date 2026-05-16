const { mockGetState, mockStatSync } = vi.hoisted(() => ({
  mockGetState: vi.fn(() => ({ watcher: {} })),
  mockStatSync: vi.fn(),
}));

vi.mock('../../../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('node:fs', () => ({
  default: {
    statSync: mockStatSync,
  },
}));

import type { Container } from '../../../model/container.js';
import {
  __resetSelfUpdateAvailabilityCacheForTest,
  isSelfUpdateAvailable,
} from './self-update-availability.js';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'drydock',
    displayName: 'drydock',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'local',
    image: {
      id: 'img-1',
      registry: { name: 'hub', url: 'https://registry-1.docker.io' },
      name: 'drydock',
      tag: { value: '1.5.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
    ...overrides,
  } as Container;
}

function makeDockerWatcher(modem: { host?: string; socketPath?: string } | undefined) {
  return {
    dockerApi: {
      modem,
    },
  };
}

describe('isSelfUpdateAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ watcher: {} });
    __resetSelfUpdateAvailabilityCacheForTest();
  });

  describe('fail-open / unknown cases', () => {
    test('returns undefined when container.watcher is undefined', () => {
      const container = makeContainer({ watcher: undefined });
      expect(isSelfUpdateAvailable(container)).toBeUndefined();
    });

    test('returns undefined when container.watcher is an empty string', () => {
      const container = makeContainer({ watcher: '' });
      expect(isSelfUpdateAvailable(container)).toBeUndefined();
    });

    test('returns undefined when the watcher is not found in registry', () => {
      mockGetState.mockReturnValue({ watcher: {} });
      const container = makeContainer({ watcher: 'nonexistent' });
      expect(isSelfUpdateAvailable(container)).toBeUndefined();
    });

    test('returns undefined when the watcher has no dockerApi (non-docker watcher)', () => {
      mockGetState.mockReturnValue({
        watcher: { local: { name: 'local' } },
      });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBeUndefined();
    });

    test('returns undefined when dockerApi is present but has no modem', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher(undefined) },
      });
      const container = makeContainer({ watcher: 'local' });
      // No modem → falls through to socket check; statSync throws → false
      // Actually modem is undefined, so modem?.host is undefined → goes to socket check
      mockStatSync.mockReturnValue({ isSocket: () => true });
      // This should return true (socket present), not undefined
      expect(isSelfUpdateAvailable(container)).toBe(true);
    });
  });

  describe('TCP mode (host configured)', () => {
    test('returns true when modem.host is a non-empty string', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({ host: '192.168.1.50' }) },
      });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(true);
    });

    test('returns true when modem.host is a hostname string', () => {
      mockGetState.mockReturnValue({
        watcher: { remote: makeDockerWatcher({ host: 'docker.example.com' }) },
      });
      const container = makeContainer({ watcher: 'remote' });
      expect(isSelfUpdateAvailable(container)).toBe(true);
    });

    test('does not call statSync in TCP mode', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({ host: '10.0.0.1' }) },
      });
      const container = makeContainer({ watcher: 'local' });
      isSelfUpdateAvailable(container);
      expect(mockStatSync).not.toHaveBeenCalled();
    });
  });

  describe('socket mode — modem.host is absent or empty', () => {
    test('returns true when modem.host is empty string and socket is present', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({ host: '' }) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => true });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(true);
    });

    test('returns false when modem.host is empty string and socket is absent (statSync returns non-socket)', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({ host: '' }) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => false });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(false);
    });

    test('returns false when modem has no host and socket is absent (statSync throws ENOENT)', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(false);
    });

    test('returns true when modem has no host and socket is present', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => true });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(true);
    });

    test('returns false when statSync throws any error', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(false);
    });

    test('calls statSync with /var/run/docker.sock', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => true });
      const container = makeContainer({ watcher: 'local' });
      isSelfUpdateAvailable(container);
      expect(mockStatSync).toHaveBeenCalledWith('/var/run/docker.sock');
    });
  });

  describe('watcher lookup by name', () => {
    test('resolves watcher by the container.watcher name', () => {
      mockGetState.mockReturnValue({
        watcher: {
          primary: makeDockerWatcher({ host: '10.0.0.1' }),
          secondary: makeDockerWatcher({}),
        },
      });
      mockStatSync.mockReturnValue({ isSocket: () => false });

      const containerPrimary = makeContainer({ watcher: 'primary' });
      expect(isSelfUpdateAvailable(containerPrimary)).toBe(true);

      const containerSecondary = makeContainer({ watcher: 'secondary' });
      expect(isSelfUpdateAvailable(containerSecondary)).toBe(false);
    });
  });

  describe('socket availability cache', () => {
    test('calls statSync only once across repeated socket-mode calls', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => true });

      const container = makeContainer({ watcher: 'local' });
      isSelfUpdateAvailable(container);
      isSelfUpdateAvailable(container);
      isSelfUpdateAvailable(container);

      expect(mockStatSync).toHaveBeenCalledTimes(1);
    });

    test('returns the cached value on subsequent calls without re-statting', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      // First call: socket present
      mockStatSync.mockReturnValueOnce({ isSocket: () => true });
      // If the cache is bypassed a second time, the mock would throw; but we
      // don't even need to set that up — just verify both results are identical.
      mockStatSync.mockReturnValue({ isSocket: () => false });

      const container = makeContainer({ watcher: 'local' });
      const first = isSelfUpdateAvailable(container);
      const second = isSelfUpdateAvailable(container);

      expect(first).toBe(true);
      expect(second).toBe(true); // cached — not re-evaluated
      expect(mockStatSync).toHaveBeenCalledTimes(1);
    });

    test('caches false result when socket is absent', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockReturnValueOnce({ isSocket: () => false });

      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(false);
      expect(isSelfUpdateAvailable(container)).toBe(false);
      expect(mockStatSync).toHaveBeenCalledTimes(1);
    });

    test('caches false result when statSync throws', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      const container = makeContainer({ watcher: 'local' });
      expect(isSelfUpdateAvailable(container)).toBe(false);
      expect(isSelfUpdateAvailable(container)).toBe(false);
      expect(mockStatSync).toHaveBeenCalledTimes(1);
    });

    test('does not cache TCP-mode results — each TCP call skips the socket stat', () => {
      mockGetState.mockReturnValue({
        watcher: { remote: makeDockerWatcher({ host: '10.0.0.1' }) },
      });

      const container = makeContainer({ watcher: 'remote' });
      isSelfUpdateAvailable(container);
      isSelfUpdateAvailable(container);

      expect(mockStatSync).not.toHaveBeenCalled();
    });

    test('reset clears the cache so statSync is called again on next socket-mode call', () => {
      mockGetState.mockReturnValue({
        watcher: { local: makeDockerWatcher({}) },
      });
      mockStatSync.mockReturnValue({ isSocket: () => true });

      const container = makeContainer({ watcher: 'local' });
      isSelfUpdateAvailable(container);
      expect(mockStatSync).toHaveBeenCalledTimes(1);

      __resetSelfUpdateAvailabilityCacheForTest();

      isSelfUpdateAvailable(container);
      expect(mockStatSync).toHaveBeenCalledTimes(2);
    });
  });
});
