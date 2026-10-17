import { getImageHost, type ImageDockerApi, isImageDockerApi, listImageHosts } from './hosts.js';

function createDockerApi(): ImageDockerApi {
  return {
    listImages: vi.fn(),
    listContainers: vi.fn(),
    pruneImages: vi.fn(),
  };
}

describe('isImageDockerApi', () => {
  test('returns false for null', () => {
    expect(isImageDockerApi(null)).toBe(false);
  });

  test('returns false for a partial object missing methods', () => {
    expect(isImageDockerApi({ listImages: vi.fn() })).toBe(false);
  });

  test('returns true for an object with all three methods', () => {
    expect(isImageDockerApi(createDockerApi())).toBe(true);
  });
});

describe('listImageHosts', () => {
  test('resolves a local docker watcher as supported with no agent', () => {
    const dockerApi = createDockerApi();
    const hosts = listImageHosts({
      'docker.local': { type: 'docker', name: 'local', dockerApi },
    });

    expect(hosts).toEqual([{ id: 'docker.local', name: 'local', supported: true, dockerApi }]);
  });

  test('resolves an agent docker watcher with a dockerApi as supported with agent set', () => {
    const dockerApi = createDockerApi();
    const hosts = listImageHosts({
      'edge.docker.remote': { type: 'docker', name: 'remote', agent: 'edge', dockerApi },
    });

    expect(hosts).toEqual([
      { id: 'edge.docker.remote', name: 'remote', agent: 'edge', supported: true, dockerApi },
    ]);
  });

  test('resolves an agent docker watcher without a dockerApi as unsupported with a reason', () => {
    const hosts = listImageHosts({
      'edge.docker.remote': { type: 'docker', name: 'remote', agent: 'edge' },
    });

    expect(hosts).toEqual([
      {
        id: 'edge.docker.remote',
        name: 'remote',
        agent: 'edge',
        supported: false,
        reason: 'agent-transport-unsupported',
      },
    ]);
  });

  test('treats an empty-string agent as no agent', () => {
    const hosts = listImageHosts({
      'docker.local': { type: 'docker', name: 'local', agent: '', dockerApi: createDockerApi() },
    });

    expect(hosts[0].agent).toBeUndefined();
  });

  test('resolves a local docker watcher without a dockerApi as unsupported with no reason', () => {
    const hosts = listImageHosts({
      'docker.local': { type: 'docker', name: 'local' },
    });

    expect(hosts).toEqual([{ id: 'docker.local', name: 'local', supported: false }]);
  });

  test('falls back to an empty name when the watcher has no string name', () => {
    const hosts = listImageHosts({
      'docker.local': { type: 'docker' },
    });

    expect(hosts[0].name).toBe('');
  });

  test('skips non-docker watcher entries', () => {
    const hosts = listImageHosts({
      'docker.local': { type: 'docker', name: 'local', dockerApi: createDockerApi() },
      'other.thing': { type: 'other', name: 'thing' },
      malformed: 'not-an-object',
    });

    expect(hosts.map((host) => host.id)).toEqual(['docker.local']);
  });

  test('sorts hosts by id', () => {
    const hosts = listImageHosts({
      'docker.zzz': { type: 'docker', name: 'zzz' },
      'docker.aaa': { type: 'docker', name: 'aaa' },
    });

    expect(hosts.map((host) => host.id)).toEqual(['docker.aaa', 'docker.zzz']);
  });
});

describe('getImageHost', () => {
  test('returns the entry for an exact id', () => {
    const dockerApi = createDockerApi();
    const watchers = {
      'docker.local': { type: 'docker', name: 'local', dockerApi },
    };

    expect(getImageHost(watchers, 'docker.local')).toEqual({
      id: 'docker.local',
      name: 'local',
      supported: true,
      dockerApi,
    });
  });

  test('returns undefined for an unknown id', () => {
    const watchers = {
      'docker.local': { type: 'docker', name: 'local' },
    };

    expect(getImageHost(watchers, 'docker.missing')).toBeUndefined();
  });
});
