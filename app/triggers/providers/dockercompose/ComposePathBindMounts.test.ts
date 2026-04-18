import path from 'node:path';

import {
  getSelfContainerBindMounts,
  getSelfContainerIdentifier,
  mapComposePathToContainerBindMount,
  parseHostToContainerBindMount,
} from './ComposePathBindMounts.js';

describe('ComposePathBindMounts', () => {
  test('parseHostToContainerBindMount parses valid bind mounts and rejects invalid definitions', () => {
    expect(parseHostToContainerBindMount('/host/app:/container/app:ro')).toEqual({
      source: '/host/app',
      destination: '/container/app',
    });
    expect(parseHostToContainerBindMount('relative:/container/app')).toBeNull();
    expect(parseHostToContainerBindMount('/host/app:relative')).toBeNull();
    expect(parseHostToContainerBindMount('/host-only')).toBeNull();
  });

  test('getSelfContainerIdentifier trims valid names and rejects invalid hostnames', () => {
    expect(getSelfContainerIdentifier(' drydock-app_1 ')).toBe('drydock-app_1');
    expect(getSelfContainerIdentifier('')).toBeNull();
    expect(getSelfContainerIdentifier('bad/name')).toBeNull();
  });

  test('getSelfContainerBindMounts returns an empty list when docker api or identifier is missing', async () => {
    await expect(getSelfContainerBindMounts(undefined, 'drydock')).resolves.toEqual([]);
    await expect(
      getSelfContainerBindMounts(
        {
          getContainer: vi.fn(),
        },
        null,
      ),
    ).resolves.toEqual([]);
  });

  test('getSelfContainerBindMounts filters invalid binds and sorts the longest source first', async () => {
    const dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          HostConfig: {
            Binds: [
              '/host/project:/container/project',
              '/host/project/nested:/container/project/nested:ro',
              'invalid-bind',
            ],
          },
        }),
      }),
    };

    await expect(getSelfContainerBindMounts(dockerApi, 'drydock')).resolves.toEqual([
      {
        source: '/host/project/nested',
        destination: '/container/project/nested',
      },
      {
        source: '/host/project',
        destination: '/container/project',
      },
    ]);
  });

  test('getSelfContainerBindMounts returns an empty list when inspect does not expose bind mounts', async () => {
    const dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          HostConfig: {},
        }),
      }),
    };

    await expect(getSelfContainerBindMounts(dockerApi, 'drydock')).resolves.toEqual([]);
  });

  test('mapComposePathToContainerBindMount maps exact and nested paths while preserving unmatched inputs', () => {
    const bindMounts = [
      {
        source: '/host/project',
        destination: '/container/project',
      },
    ];

    expect(mapComposePathToContainerBindMount('/host/project', bindMounts)).toBe(
      '/container/project',
    );
    expect(mapComposePathToContainerBindMount('/host/project/docker-compose.yml', bindMounts)).toBe(
      '/container/project/docker-compose.yml',
    );
    expect(mapComposePathToContainerBindMount('/host/other/docker-compose.yml', bindMounts)).toBe(
      '/host/other/docker-compose.yml',
    );
    expect(mapComposePathToContainerBindMount('docker-compose.yml', bindMounts)).toBe(
      'docker-compose.yml',
    );
  });

  test('mapComposePathToContainerBindMount returns the destination root when the relative path is empty', () => {
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('');

    try {
      expect(
        mapComposePathToContainerBindMount('/host/project/docker-compose.yml', [
          {
            source: '/host/project/',
            destination: '/container/project',
          },
        ]),
      ).toBe('/container/project');
    } finally {
      relativeSpy.mockRestore();
    }
  });

  test('mapComposePathToContainerBindMount skips unsafe relative paths that escape the source', () => {
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('../escape.yml');

    try {
      expect(
        mapComposePathToContainerBindMount('/host/project/docker-compose.yml', [
          {
            source: '/host/project/',
            destination: '/container/project',
          },
        ]),
      ).toBe('/host/project/docker-compose.yml');
    } finally {
      relativeSpy.mockRestore();
    }
  });
});
