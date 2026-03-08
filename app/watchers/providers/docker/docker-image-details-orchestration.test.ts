import { afterEach, describe, expect, test, vi } from 'vitest';

import * as storeContainer from '../../../store/container.js';
import { addImageDetailsToContainerOrchestration } from './docker-image-details-orchestration.js';

function createDockerSummaryContainer(overrides: Record<string, any> = {}) {
  return {
    Id: 'container-1',
    Image: 'ghcr.io/acme/service:latest',
    State: 'running',
    Labels: {},
    Names: ['/service'],
    Ports: [],
    Mounts: [],
    ...overrides,
  };
}

function createWatcher(overrides: Record<string, any> = {}) {
  const inspectContainer = vi.fn().mockResolvedValue({});
  const inspectImage = vi.fn().mockResolvedValue({
    Id: 'image-new',
    RepoDigests: ['ghcr.io/acme/service@sha256:new'],
    Architecture: 'amd64',
    Os: 'linux',
    Variant: 'v8',
    Created: '2026-02-01T00:00:00.000Z',
  });

  const watcher = {
    name: 'docker-test',
    configuration: {
      watchevents: false,
    },
    dockerApi: {
      getContainer: vi.fn().mockReturnValue({
        inspect: inspectContainer,
      }),
      getImage: vi.fn().mockReturnValue({
        inspect: inspectImage,
      }),
    },
    log: {
      warn: vi.fn(),
      debug: vi.fn(),
    },
    ensureLogger: vi.fn(),
    ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    watcher,
    inspectContainer,
    inspectImage,
  };
}

function createHelpers(overrides: Record<string, any> = {}) {
  return {
    resolveLabelsFromContainer: vi.fn(
      (_labels: Record<string, string>, incomingOverrides: any) => ({
        transformTags: incomingOverrides?.transformTags,
      }),
    ),
    mergeConfigWithImgset: vi.fn((labelOverrides: any) => ({
      includeTags: undefined,
      excludeTags: undefined,
      transformTags: labelOverrides.transformTags,
      tagFamily: undefined,
      linkTemplate: undefined,
      displayName: undefined,
      displayIcon: undefined,
      triggerInclude: undefined,
      triggerExclude: undefined,
      watchDigest: undefined,
      inspectTagPath: undefined,
      lookupImage: undefined,
    })),
    normalizeContainer: vi.fn((container: any) => container),
    resolveImageName: vi.fn().mockReturnValue({
      domain: 'ghcr.io',
      path: 'acme/service',
    }),
    resolveTagName: vi.fn().mockReturnValue('1.2.3'),
    getMatchingImgsetConfiguration: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('docker image details orchestration module', () => {
  test('refreshes runtime and image details for containers already present in store', async () => {
    const containerInStore = {
      id: 'container-1',
      error: undefined,
      details: {
        ports: ['cached-port'],
        volumes: ['cached-volume'],
        env: [{ key: 'CACHED', value: '1' }],
      },
      image: {
        id: 'image-old',
        digest: {
          repo: 'sha256:old',
          value: undefined,
        },
        created: '2024-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({
      NetworkSettings: {
        Ports: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
        },
      },
      Mounts: [{ Source: '/runtime', Destination: '/data', RW: false }],
      Config: {
        Env: ['APP_ENV=prod'],
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoDigests: ['ghcr.io/acme/service@sha256:new'],
      Created: '2026-03-01T00:00:00.000Z',
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer(),
      {},
      createHelpers() as any,
    );

    expect(result).toBe(containerInStore);
    expect(watcher.ensureRemoteAuthHeaders).not.toHaveBeenCalled();
    expect(watcher.ensureLogger).toHaveBeenCalledTimes(1);
    expect(watcher.log.debug).toHaveBeenCalledWith('Container container-1 already in store');
    expect(watcher.dockerApi.getContainer).toHaveBeenCalledWith('container-1');
    expect(containerInStore.details).toEqual({
      ports: ['0.0.0.0:8080->80/tcp'],
      volumes: ['/runtime:/data:ro'],
      env: [{ key: 'APP_ENV', value: 'prod' }],
    });
    expect(containerInStore.image.id).toBe('image-new');
    expect(containerInStore.image.digest).toEqual({
      repo: 'sha256:new',
      value: 'sha256:new',
    });
    expect(containerInStore.image.created).toBe('2026-03-01T00:00:00.000Z');
  });

  test('skips container inspect when docker events are enabled and backfills digest value', async () => {
    const containerInStore = {
      id: 'container-1',
      error: undefined,
      details: {
        ports: [],
        volumes: ['/cached:/data'],
        env: [{ key: 'KEEP', value: '1' }],
      },
      image: {
        id: 'image-same',
        digest: {
          repo: 'sha256:same',
          value: undefined,
        },
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectImage } = createWatcher({
      configuration: {
        watchevents: true,
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-same',
      RepoDigests: ['ghcr.io/acme/service@sha256:same'],
      Created: '2026-03-01T00:00:00.000Z',
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Ports: [{ PrivatePort: 443, Type: 'tcp' }],
      }),
      {},
      createHelpers() as any,
    );

    expect(watcher.dockerApi.getContainer).not.toHaveBeenCalled();
    expect(containerInStore.details).toEqual({
      ports: ['443/tcp'],
      volumes: ['/cached:/data'],
      env: [{ key: 'KEEP', value: '1' }],
    });
    expect(containerInStore.image.digest.value).toBe('sha256:same');
    expect(containerInStore.image.created).toBe('2025-01-01T00:00:00.000Z');
  });

  test('reconciles container status from Docker summary when it differs from store', async () => {
    const containerInStore = {
      id: 'container-1',
      status: 'stopped',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        id: 'image-old',
        digest: {
          repo: 'sha256:old',
          value: 'sha256:old',
        },
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher } = createWatcher({
      configuration: { watchevents: true },
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({ State: 'running' }),
      {},
      createHelpers() as any,
    );

    expect(result).toBe(containerInStore);
    expect(containerInStore.status).toBe('running');
  });

  test('throws a clear error when image inspection fails for a new container', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectImage } = createWatcher();
    inspectImage.mockRejectedValue(new Error('inspect failed'));

    await expect(
      addImageDetailsToContainerOrchestration(
        watcher as any,
        createDockerSummaryContainer(),
        {},
        createHelpers() as any,
      ),
    ).rejects.toThrow('Unable to inspect image for container container-1: inspect failed');
    expect(watcher.ensureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
  });

  test('throws a clear error when image inspection rejects with a non-Error value', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectImage } = createWatcher();
    inspectImage.mockRejectedValue('inspect failed as string');

    await expect(
      addImageDetailsToContainerOrchestration(
        watcher as any,
        createDockerSummaryContainer(),
        {},
        createHelpers() as any,
      ),
    ).rejects.toThrow(
      'Unable to inspect image for container container-1: inspect failed as string',
    );
  });

  test('returns undefined when image parsing cannot resolve a normalized image name', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher } = createWatcher();
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue(undefined),
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer(),
      {},
      helpers as any,
    );

    expect(result).toBeUndefined();
    expect(helpers.resolveLabelsFromContainer).not.toHaveBeenCalled();
  });

  test('assembles a normalized container payload and warns when updates cannot be detected', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectContainer } = createWatcher();
    inspectContainer.mockResolvedValue({
      NetworkSettings: {
        Ports: {
          '90/tcp': [{ HostIp: '0.0.0.0', HostPort: '9000' }],
        },
      },
      Mounts: [{ Source: '/runtime', Destination: '/data', RW: true }],
      Config: {
        Env: ['MODE=prod'],
      },
    });

    const parsedImage = {
      domain: 'docker.io',
      path: 'library/service',
    };
    const matchingImgset = {
      name: 'preferred',
    };
    const resolvedLabelOverrides = {
      transformTags: 's/v//',
    };
    const resolvedConfig = {
      includeTags: '^stable$',
      excludeTags: '^dev$',
      transformTags: 's/v//',
      tagFamily: 'stable',
      linkTemplate: 'https://example.com/releases/${major}',
      displayName: '',
      displayIcon: 'mdi:cube',
      triggerInclude: '^release$',
      triggerExclude: '^ignore$',
      watchDigest: undefined,
      inspectTagPath: 'Config/Labels/org.opencontainers.image.version',
      lookupImage: 'mirror/library/service',
    };
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue(parsedImage),
      resolveLabelsFromContainer: vi.fn().mockReturnValue(resolvedLabelOverrides),
      getMatchingImgsetConfiguration: vi.fn().mockReturnValue(matchingImgset),
      mergeConfigWithImgset: vi.fn().mockReturnValue(resolvedConfig),
      resolveTagName: vi.fn().mockReturnValue('latest'),
      normalizeContainer: vi.fn((container: any) => ({
        ...container,
        normalized: true,
      })),
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Labels: { app: 'service' },
      }),
      {
        transformTags: 's/v//',
      },
      helpers as any,
    );

    expect(helpers.resolveTagName).toHaveBeenCalledWith(
      parsedImage,
      expect.objectContaining({ Id: 'image-new' }),
      'Config/Labels/org.opencontainers.image.version',
      's/v//',
      'container-1',
    );
    expect(watcher.log.debug).toHaveBeenCalledWith(
      'Apply imgset "preferred" to container container-1',
    );
    expect(watcher.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Image is not a semver and digest watching is disabled'),
    );

    expect(result).toMatchObject({
      normalized: true,
      id: 'container-1',
      name: 'service',
      displayName: 'service',
      image: {
        name: 'library/service',
        registry: {
          url: 'docker.io',
          lookupImage: 'mirror/library/service',
        },
        tag: {
          value: 'latest',
          semver: false,
        },
        digest: {
          watch: false,
          repo: 'sha256:new',
          value: 'sha256:new',
        },
      },
      details: {
        ports: ['0.0.0.0:9000->90/tcp'],
        volumes: ['/runtime:/data'],
        env: [{ key: 'MODE', value: 'prod' }],
      },
      result: {
        tag: 'latest',
      },
    });
  });

  test('falls back to summary runtime details when container inspect is unavailable', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectContainer } = createWatcher();
    inspectContainer.mockRejectedValue(new Error('container inspect failed'));

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Ports: [{ PrivatePort: 3000, Type: 'tcp', PublicPort: 13000, IP: '127.0.0.1' }],
        Mounts: [{ Source: '/host/logs', Destination: '/logs', RW: false }],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.details).toEqual({
      ports: ['127.0.0.1:13000->3000/tcp'],
      volumes: ['/host/logs:/logs:ro'],
      env: [],
    });
    expect(watcher.log.warn).not.toHaveBeenCalled();
  });
});
