import { afterEach, describe, expect, test, vi } from 'vitest';

import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import {
  addImageDetailsToContainerOrchestration,
  testable_classifyTagPrecision,
  testable_getNumericTagShape,
} from './docker-image-details-orchestration.js';

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
  test('testable_getNumericTagShape derives numeric segment counts across tag formats', () => {
    expect(testable_getNumericTagShape('1.2.3', undefined)).toMatchObject({
      prefix: '',
      numericSegments: ['1', '2', '3'],
      suffix: '',
    });
    expect(testable_getNumericTagShape('v3', undefined)).toMatchObject({
      prefix: 'v',
      numericSegments: ['3'],
      suffix: '',
    });
    expect(testable_getNumericTagShape('1.4-alpine', undefined)).toMatchObject({
      prefix: '',
      numericSegments: ['1', '4'],
      suffix: '-alpine',
    });
    expect(testable_getNumericTagShape('v2.0.1-alpine', '^v(.*) => $1')).toMatchObject({
      prefix: '',
      numericSegments: ['2', '0', '1'],
      suffix: '-alpine',
    });
    expect(testable_getNumericTagShape('latest', undefined)).toBeNull();
  });

  test('testable_classifyTagPrecision distinguishes specific releases from floating aliases', () => {
    expect(testable_classifyTagPrecision('1.2.3', undefined, {})).toBe('specific');
    expect(testable_classifyTagPrecision('1.4', undefined, {})).toBe('floating');
    expect(testable_classifyTagPrecision('v3', undefined, {})).toBe('floating');
    expect(testable_classifyTagPrecision('latest', undefined, {})).toBe('floating');
    expect(testable_classifyTagPrecision('v2.0.1-alpine', '^v(.*) => $1', {})).toBe('specific');
    expect(testable_classifyTagPrecision('1.2.3', undefined, null)).toBe('floating');
  });

  test('returns undefined for containers with empty Image (Podman pod infra)', async () => {
    const { watcher } = createWatcher();
    const container = createDockerSummaryContainer({ Image: '' });
    const helpers = createHelpers();

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      container,
      {},
      helpers as any,
    );

    expect(result).toBeUndefined();
    expect(watcher.dockerApi.getImage).not.toHaveBeenCalled();
  });

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

  test('re-normalizes stored digest-only image references from container inspect', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'service',
      displayName: 'service',
      status: 'running',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        id: 'image-old',
        name: 'linuxserver/socket-proxy',
        registry: {
          name: 'unknown',
          url: 'lscr.io',
        },
        tag: {
          value: 'sha256:deadbeef',
          semver: false,
        },
        digest: {
          repo: 'sha256:old',
          value: 'sha256:old',
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({
      Config: {
        Image: 'lscr.io/linuxserver/socket-proxy:latest',
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoTags: [],
      RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:new'],
      Architecture: 'amd64',
      Os: 'linux',
      Created: '2026-03-01T00:00:00.000Z',
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue({
        domain: 'lscr.io',
        path: 'linuxserver/socket-proxy',
        tag: 'latest',
      }),
      resolveTagName: vi.fn().mockReturnValue('latest'),
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
        Names: ['/docker-socket-proxy'],
      }),
      {},
      helpers as any,
    );

    expect(helpers.resolveImageName).toHaveBeenCalledWith(
      'lscr.io/linuxserver/socket-proxy:latest',
      expect.objectContaining({
        RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:new'],
      }),
      'docker-socket-proxy',
    );
    expect(containerInStore.image.name).toBe('linuxserver/socket-proxy');
    expect(containerInStore.image.tag.value).toBe('latest');
    expect(containerInStore.image.digest).toEqual({
      repo: 'sha256:new',
      value: 'sha256:new',
      watch: true,
    });
    expect(containerInStore.image.registry.url).toBe('lscr.io');
  });

  test('repairs stored digest-only image references with cached metadata when resolved image data is partial', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'service',
      displayName: 'service',
      status: 'running',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        id: 'image-old',
        name: 'acme/service',
        registry: undefined,
        tag: {
          value: 'sha256:deadbeef',
          semver: false,
        },
        digest: {
          repo: 'sha256:old',
          value: 'sha256:cached-value',
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
        variant: 'v8',
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({
      Config: {
        Image: 'acme/service:latest',
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoDigests: [],
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue({
        domain: undefined,
        path: 'acme/service',
        tag: 'latest',
      }),
      resolveTagName: vi.fn().mockReturnValue('latest'),
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
        Labels: undefined,
      }),
      {},
      helpers as any,
    );

    expect(containerInStore.image).toMatchObject({
      id: 'image-new',
      name: 'acme/service',
      registry: {
        name: 'unknown',
        url: '',
      },
      tag: {
        value: 'latest',
        semver: false,
      },
      digest: {
        repo: undefined,
        value: 'sha256:cached-value',
        watch: true,
      },
      architecture: 'amd64',
      os: 'linux',
      variant: 'v8',
      created: '2025-01-01T00:00:00.000Z',
    });
    expect(containerInStore.sourceRepo).toBeUndefined();
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

  test('still inspects stored digest-only containers when docker events are enabled to repair image references', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'docker-socket-proxy',
      displayName: 'docker-socket-proxy',
      status: 'running',
      error: undefined,
      details: {
        ports: ['443/tcp'],
        volumes: [],
        env: [],
      },
      image: {
        id: 'image-old',
        name: 'linuxserver/socket-proxy',
        registry: {
          name: 'unknown',
          url: 'lscr.io',
        },
        tag: {
          value: 'sha256:deadbeef',
          semver: false,
        },
        digest: {
          repo: 'sha256:old',
          value: 'sha256:old',
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectContainer, inspectImage } = createWatcher({
      configuration: {
        watchevents: true,
      },
    });
    inspectContainer.mockResolvedValue({
      Config: {
        Image: 'lscr.io/linuxserver/socket-proxy:latest',
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoTags: [],
      RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:new'],
      Architecture: 'amd64',
      Os: 'linux',
      Created: '2026-03-01T00:00:00.000Z',
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue({
        domain: 'lscr.io',
        path: 'linuxserver/socket-proxy',
        tag: 'latest',
      }),
      resolveTagName: vi.fn().mockReturnValue('latest'),
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
        Names: ['/docker-socket-proxy'],
      }),
      {},
      helpers as any,
    );

    expect(watcher.dockerApi.getContainer).toHaveBeenCalledWith('container-1');
    expect(containerInStore.image.tag.value).toBe('latest');
    expect(containerInStore.image.digest).toEqual({
      repo: 'sha256:new',
      value: 'sha256:new',
      watch: true,
    });
  });

  test('keeps cached refresh behavior when stored digest-only image references cannot be reparsed', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'service',
      displayName: 'service',
      status: 'running',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        id: 'image-old',
        name: 'acme/service',
        registry: {
          name: 'ghcr',
          url: 'ghcr.io',
        },
        tag: {
          value: 'sha256:deadbeef',
          semver: false,
        },
        digest: {
          repo: 'sha256:old',
          value: undefined,
          watch: false,
        },
        created: '2025-01-01T00:00:00.000Z',
      },
    };
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(containerInStore as any);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({
      Config: {
        Image: 'ghcr.io/acme/service:latest',
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoDigests: ['ghcr.io/acme/service@sha256:new'],
      Created: '2026-03-01T00:00:00.000Z',
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue(undefined),
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
      }),
      {},
      helpers as any,
    );

    expect(helpers.normalizeContainer).not.toHaveBeenCalled();
    expect(containerInStore.image.id).toBe('image-new');
    expect(containerInStore.image.digest).toEqual({
      repo: 'sha256:new',
      value: 'sha256:new',
      watch: false,
    });
    expect(containerInStore.image.created).toBe('2026-03-01T00:00:00.000Z');
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

  test('refreshes cached container name from Docker summary when it changes', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'temp-name-123',
      displayName: 'temp-name-123',
      status: 'running',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        name: 'acme/service',
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
      createDockerSummaryContainer({ Names: ['/service'] }),
      {},
      createHelpers() as any,
    );

    expect(result).toBe(containerInStore);
    expect(containerInStore.name).toBe('service');
    expect(containerInStore.displayName).toBe('service');
  });

  test('keeps custom displayName when container name changes', async () => {
    const containerInStore = {
      id: 'container-1',
      name: 'temp-name-123',
      displayName: 'Friendly Service',
      status: 'running',
      error: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [],
      },
      image: {
        name: 'acme/service',
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
      createDockerSummaryContainer({ Names: ['/service'] }),
      {},
      createHelpers() as any,
    );

    expect(result).toBe(containerInStore);
    expect(containerInStore.name).toBe('service');
    expect(containerInStore.displayName).toBe('Friendly Service');
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
    expect(watcher.log.warn).toHaveBeenCalledWith(expect.stringContaining('container "service"'));

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

  test('detects sourceRepo from manual label override and OCI source labels', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({});
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoDigests: ['ghcr.io/acme/service@sha256:new'],
      Architecture: 'amd64',
      Os: 'linux',
      Created: '2026-02-01T00:00:00.000Z',
      Config: {
        Labels: {
          'org.opencontainers.image.source': 'https://github.com/acme/service',
        },
      },
    });

    const resultFromImageSource = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Labels: {},
      }),
      {},
      createHelpers() as any,
    );

    expect(resultFromImageSource?.sourceRepo).toBe('github.com/acme/service');

    const resultFromManualOverride = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Labels: {
          'dd.source.repo': 'github.com/acme/override',
        },
      }),
      {},
      createHelpers() as any,
    );

    expect(resultFromManualOverride?.sourceRepo).toBe('github.com/acme/override');
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

  test('uses container inspect image reference when summary only exposes a digest image id', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectContainer, inspectImage } = createWatcher();
    inspectContainer.mockResolvedValue({
      Config: {
        Image: 'lscr.io/linuxserver/socket-proxy:latest',
      },
    });
    inspectImage.mockResolvedValue({
      Id: 'image-new',
      RepoTags: [],
      RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:new'],
      Architecture: 'amd64',
      Os: 'linux',
      Created: '2026-02-01T00:00:00.000Z',
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue({
        domain: 'lscr.io',
        path: 'linuxserver/socket-proxy',
        tag: 'latest',
      }),
      resolveTagName: vi.fn().mockReturnValue('latest'),
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
        Names: ['/docker-socket-proxy'],
      }),
      {},
      helpers as any,
    );

    expect(helpers.resolveImageName).toHaveBeenCalledWith(
      'lscr.io/linuxserver/socket-proxy:latest',
      expect.objectContaining({
        RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:new'],
      }),
      'docker-socket-proxy',
    );
    expect(result?.image.tag.value).toBe('latest');
    expect(result?.image.digest.watch).toBe(true);
  });

  test('falls back to the summary image reference when inspect image reference is blank', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);

    const { watcher, inspectContainer } = createWatcher();
    inspectContainer.mockResolvedValue({
      Config: {
        Image: '   ',
      },
    });
    const helpers = createHelpers({
      resolveImageName: vi.fn().mockReturnValue({
        domain: 'docker.io',
        path: 'library/nginx',
        tag: 'latest',
      }),
      resolveTagName: vi.fn().mockReturnValue('latest'),
    });

    await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Image: 'sha256:deadbeef',
      }),
      {},
      helpers as any,
    );

    expect(helpers.resolveImageName).toHaveBeenCalledWith(
      'sha256:deadbeef',
      expect.anything(),
      'service',
    );
  });

  test('removes stale same-name container entries when a new container id is discovered', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    const getContainersSpy = vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'old-container-id',
        watcher: 'docker-test',
        name: 'service',
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});

    const { watcher } = createWatcher();

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: ['/service'],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(getContainersSpy).toHaveBeenCalledWith();
    expect(deleteContainerSpy).toHaveBeenCalledWith('old-container-id', {
      replacementExpected: true,
    });
  });

  test('removes stale alias-prefixed entries when the canonical replacement container is discovered', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: '7ea6b8a42686old-container-id',
        watcher: 'docker-test',
        name: '7ea6b8a42686_service',
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});

    const { watcher } = createWatcher();

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: ['/service'],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(deleteContainerSpy).toHaveBeenCalledWith('7ea6b8a42686old-container-id', {
      replacementExpected: true,
    });
  });

  test('removes stale same-name entries from a different watcher when both watchers point to the same docker source', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'old-container-current-watcher',
        watcher: 'docker-test',
        name: 'service',
      } as any,
      {
        id: 'old-container-same-source-different-watcher',
        watcher: 'docker-alias',
        name: 'service',
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});
    vi.spyOn(registry, 'getState').mockReturnValue({
      watcher: {
        'docker.docker-test': {
          type: 'docker',
          name: 'docker-test',
          configuration: {
            host: 'socket-proxy.internal',
            protocol: 'http',
            port: 2375,
            socket: '/var/run/docker.sock',
          },
        },
        'docker.docker-alias': {
          type: 'docker',
          name: 'docker-alias',
          configuration: {
            host: 'socket-proxy.internal',
            protocol: 'http',
            port: 2375,
            socket: '/var/run/docker.sock',
          },
        },
      },
    } as any);

    const { watcher } = createWatcher({
      configuration: {
        watchevents: false,
        host: 'socket-proxy.internal',
        protocol: 'http',
        port: 2375,
        socket: '/var/run/docker.sock',
      },
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: ['/service'],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(deleteContainerSpy).toHaveBeenCalledWith('old-container-current-watcher', {
      replacementExpected: true,
    });
    expect(deleteContainerSpy).toHaveBeenCalledWith('old-container-same-source-different-watcher', {
      replacementExpected: true,
    });
  });

  test('skips same-name dedupe when the discovered container name is empty', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    const getContainersSpy = vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'old-container-id',
        watcher: 'docker-test',
        name: '',
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});

    const { watcher } = createWatcher();

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: [],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(result?.name).toBe('');
    expect(getContainersSpy).not.toHaveBeenCalled();
    expect(deleteContainerSpy).not.toHaveBeenCalled();
  });

  test('skips stale same-name entries with missing, blank, or non-docker watcher metadata', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'old-container-empty-watcher',
        watcher: '',
        name: 'service',
      } as any,
      {
        id: 'old-container-whitespace-watcher',
        watcher: '   ',
        name: 'service',
      } as any,
      {
        id: 'old-container-non-docker',
        watcher: 'docker-queue',
        name: 'service',
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});
    vi.spyOn(registry, 'getState').mockReturnValue({
      watcher: {
        'docker.docker-queue': {
          type: 'queue',
          name: 'docker-queue',
          configuration: {
            host: 'socket-proxy.internal',
            protocol: 'http',
            port: 2375,
            socket: '/var/run/docker.sock',
          },
        },
      },
    } as any);

    const { watcher } = createWatcher({
      configuration: {
        watchevents: false,
        host: 'socket-proxy.internal',
        protocol: 'http',
        port: 2375,
        socket: '/var/run/docker.sock',
      },
    });

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: ['/service'],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(deleteContainerSpy).not.toHaveBeenCalled();
  });

  test('ignores stale same-name entries whose stored names are not strings', async () => {
    vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
    vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'old-container-invalid-name',
        watcher: 'docker-test',
        name: null,
      } as any,
    ]);
    const deleteContainerSpy = vi
      .spyOn(storeContainer, 'deleteContainer')
      .mockImplementation(() => {});

    const { watcher } = createWatcher();

    const result = await addImageDetailsToContainerOrchestration(
      watcher as any,
      createDockerSummaryContainer({
        Id: 'new-container-id',
        Names: ['/service'],
      }),
      {},
      createHelpers() as any,
    );

    expect(result?.id).toBe('new-container-id');
    expect(deleteContainerSpy).not.toHaveBeenCalled();
  });
});
