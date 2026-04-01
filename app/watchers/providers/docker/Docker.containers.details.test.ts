import {
  createDockerContainer,
  createHaParseMock,
  createHarborHubRegistryState,
  createMockLog,
  setupContainerDetailTest,
  setupDockerWatcherContainerSuite,
} from './Docker.containers.test.helpers.js';

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;
  let mockImage;
  // Helper-scoped mock references (populated in beforeEach)
  let hMockParse: any;
  let hStoreContainer: any;
  let hMockTag: any;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
    mockSchedule = state.mockSchedule;
    mockContainer = state.mockContainer;
    mockImage = state.mockImage;
  });

  beforeEach(async () => {
    hMockParse = (await import('parse-docker-image-name')).default;
    hStoreContainer = await import('../../../store/container.js');
    hMockTag = await import('../../../tag/index.js');
  });

  describe('Container Details', () => {
    test('should return existing container from store', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: { digest: { repo: 'sha256:abc' }, id: 'image123', created: '2023-01-01' },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
    });

    test('should skip container inspect for store container when watch events are enabled', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:abc' },
          id: 'image123',
          created: '2023-01-01',
        },
        details: {
          ports: ['80/tcp'],
          volumes: ['/old/data:/data'],
          env: [{ key: 'APP_ENV', value: 'prod' }],
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
        Ports: [{ PrivatePort: 8080, Type: 'tcp', PublicPort: 18080, IP: '0.0.0.0' }],
        Mounts: [{ Source: '/host/data', Destination: '/data', RW: false }],
      });

      expect(result).toBe(existingContainer);
      expect(mockContainer.inspect).not.toHaveBeenCalled();
      expect(result.details).toEqual({
        ports: ['0.0.0.0:18080->8080/tcp'],
        volumes: ['/host/data:/data:ro'],
        env: [{ key: 'APP_ENV', value: 'prod' }],
      });
    });

    test('should inspect store container runtime details when watch events are disabled', async () => {
      await docker.register('watcher', 'docker', 'test', { watchevents: false });
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:abc' },
          id: 'image123',
          created: '2023-01-01',
        },
        details: {
          ports: [],
          volumes: [],
          env: [],
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Env: ['APP_ENV=prod'],
        },
      });
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      expect(mockContainer.inspect).toHaveBeenCalledTimes(1);
      expect(result.details.env).toEqual([{ key: 'APP_ENV', value: 'prod' }]);
    });

    test('should refresh image fields when digest changed in store container', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:olddigest' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: ['nginx@sha256:newdigest'],
        Created: '2024-06-15',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBe('sha256:newdigest');
      expect(result.image.id).toBe('new-image-id');
      expect(result.image.created).toBe('2024-06-15');
    });

    test('should keep existing created date when refreshed image has no Created field', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:olddigest' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: ['nginx@sha256:newdigest'],
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBe('sha256:newdigest');
      expect(result.image.id).toBe('new-image-id');
      expect(result.image.created).toBe('2023-01-01');
    });

    test('should degrade gracefully when image inspect fails for store container', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:cached' },
          id: 'cached-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockRejectedValue(new Error('image not found'));

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      expect(result.image.digest.repo).toBe('sha256:cached');
      expect(result.image.id).toBe('cached-image-id');
    });

    test('should not mutate store container when image fields unchanged', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      // Values should be unchanged
      expect(result.image.digest.repo).toBe('sha256:samedigest');
      expect(result.image.id).toBe('same-image-id');
      expect(result.image.created).toBe('2023-01-01');
    });

    test('should backfill digest value for store container when repo digest exists', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.value).toBe('sha256:samedigest');
    });

    test('should keep existing digest value when backfill is not needed', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest', value: 'sha256:already-set' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.value).toBe('sha256:already-set');
    });

    test('should keep digest value unchanged when repo digest is missing but image metadata changes', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:cached', value: 'sha256:cached' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: [],
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBeUndefined();
      expect(result.image.digest.value).toBe('sha256:cached');
      expect(result.image.id).toBe('new-image-id');
    });

    test('should set digest value from repo digest for new container details', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:latest' },
        imageDetails: { RepoDigests: ['nginx@sha256:abc123'] },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: 'latest' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.digest.repo).toBe('sha256:abc123');
      expect(result.image.digest.value).toBe('sha256:abc123');
    });

    test('should add image details to new container', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:1.0.0' },
        imageDetails: { Variant: 'v8', RepoDigests: ['nginx@sha256:abc123'] },
        validateImpl: () => ({
          id: '123',
          name: 'test-container',
          image: { architecture: 'amd64', variant: 'v8' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(mockImage.inspect).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test('should include runtime details from inspect payload', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:1.0.0' },
      });
      mockContainer.inspect.mockResolvedValue({
        NetworkSettings: {
          Ports: {
            '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
            '443/tcp': null,
          },
        },
        Mounts: [
          { Name: 'config-vol', Destination: '/config', RW: true },
          { Source: '/host/data', Destination: '/data', RW: false },
        ],
        Config: {
          Env: ['NODE_ENV=production', 'EMPTY=', 'NO_VALUE'],
        },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.details).toEqual({
        ports: ['0.0.0.0:8080->80/tcp', '443/tcp'],
        volumes: ['config-vol:/config', '/host/data:/data:ro'],
        env: [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'EMPTY', value: '' },
          { key: 'NO_VALUE', value: '' },
        ],
      });
    });

    test('should default display name to container name for drydock image', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/codeswhat/drydock:latest',
          Names: ['/dd'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/codeswhat/drydock@sha256:abc123'],
        },
        parsedImage: { domain: 'ghcr.io', path: 'codeswhat/drydock', tag: 'latest' },
        semverValue: null,
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.displayName).toBe('dd');
    });

    test('should keep custom display name when provided', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/codeswhat/drydock:latest',
          Names: ['/dd'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/codeswhat/drydock@sha256:abc123'],
        },
        parsedImage: { domain: 'ghcr.io', path: 'codeswhat/drydock', tag: 'latest' },
        semverValue: null,
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container, {
        displayName: 'DD CE Custom',
      });

      expect(result.displayName).toBe('DD CE Custom');
    });

    test('should apply imgset defaults when labels are missing', async () => {
      const haImgset = {
        homeassistant: {
          image: 'ghcr.io/home-assistant/home-assistant',
          tag: {
            include: String.raw`^\d+\.\d+\.\d+$`,
          },
          display: {
            name: 'Home Assistant',
            icon: 'mdi-home-assistant',
          },
          link: {
            template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
          },
          trigger: {
            include: 'ntfy.default:major',
          },
          registry: {
            lookup: {
              image: 'ghcr.io/home-assistant/home-assistant',
            },
          },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: haImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.includeTags).toBe(String.raw`^\d+\.\d+\.\d+$`);
      expect(result.displayName).toBe('Home Assistant');
      expect(result.displayIcon).toBe('mdi-home-assistant');
      expect(result.linkTemplate).toBe(
        'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
      );
      expect(result.triggerInclude).toBe('ntfy.default:major');
      expect(result.image.registry.lookupImage).toBe('ghcr.io/home-assistant/home-assistant');
    });

    test('should let labels override imgset defaults', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
              link: {
                template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
              },
              trigger: { include: 'ntfy.default:major' },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container, {
        includeTags: '^stable$',
        displayName: 'HA Label Name',
        displayIcon: 'mdi-docker',
        triggerInclude: 'discord.default:major',
      });

      expect(result.includeTags).toBe('^stable$');
      expect(result.displayName).toBe('HA Label Name');
      expect(result.displayIcon).toBe('mdi-docker');
      expect(result.triggerInclude).toBe('discord.default:major');
      expect(result.linkTemplate).toBe(
        'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
      );
    });

    test('should prefer dd.action and dd.notification aliases over legacy trigger labels', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
              link: {
                template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
              },
              trigger: { include: 'imgset.default:major' },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
          Labels: {
            'dd.action.include': 'action.default:major',
            'dd.notification.include': 'notification.default:major',
            'dd.trigger.include': 'legacy.default:major',
            'wud.trigger.include': 'wud.default:major',
          },
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.triggerInclude).toBe('action.default:major');
    });

    test('should apply tagFamily from container labels', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'docker.io/library/nginx:1.0.0',
          Names: ['/nginx'],
          Labels: { 'dd.tag.family': 'loose' },
        },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.tagFamily).toBe('loose');
    });

    test('should apply imgset tagFamily when label is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            nginx: {
              image: 'library/nginx',
              tag: { family: 'loose' },
            },
          },
        },
        container: {
          Image: 'docker.io/library/nginx:1.0.0',
          Names: ['/nginx'],
        },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.tagFamily).toBe('loose');
    });

    test('should apply imgset watchDigest when label is missing', async () => {
      const watchDigestImgset = {
        customregistry: {
          image: 'ghcr.io/home-assistant/home-assistant',
          watch: { digest: 'true' },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: watchDigestImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.digest.watch).toBe(true);
    });

    test('should let dd.watch.digest label override imgset watchDigest', async () => {
      const watchDigestImgset = {
        customregistry: {
          image: 'ghcr.io/home-assistant/home-assistant',
          watch: { digest: 'true' },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: watchDigestImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
          Labels: { 'dd.watch.digest': 'false' },
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      // Label says false, overriding imgset's true
      expect(result.image.digest.watch).toBe(false);
    });

    test('should apply imgset inspectTagPath when label is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            haos: {
              image: 'ghcr.io/home-assistant/home-assistant',
              inspect: {
                tag: { path: 'Config/Labels/org.opencontainers.image.version' },
              },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:stable',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
          Config: {
            Labels: { 'org.opencontainers.image.version': '2026.2.1' },
          },
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1, version: '2026.2.1' },
        registryId: 'ghcr',
      });
      hMockTag.transform.mockImplementation((_transform, value) => value);

      const result = await docker.addImageDetailsToContainer(container);

      // The tag should be resolved from the inspect path via imgset
      expect(result.image.tag.value).toBe('2026.2.1');
    });

    test('should not apply imgset when image does not match any preset', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
            },
          },
        },
        container: {
          Id: '456',
          Image: 'nginx:1.25.0',
          Names: ['/nginx'],
        },
        imageDetails: {
          Id: 'image456',
          RepoDigests: ['nginx@sha256:def456'],
        },
        parseImpl: (value) => {
          if (value === 'nginx:1.25.0')
            return { domain: undefined, path: 'library/nginx', tag: '1.25.0' };
          if (value === 'ghcr.io/home-assistant/home-assistant')
            return { domain: 'ghcr.io', path: 'home-assistant/home-assistant' };
          return { domain: undefined, path: 'library/nginx', tag: '1.25.0' };
        },
        semverValue: { major: 1, minor: 25, patch: 0 },
      });

      const result = await docker.addImageDetailsToContainer(container);

      // No imgset should be applied - fields should be undefined
      expect(result.includeTags).toBeUndefined();
      expect(result.displayName).toBe('nginx');
      expect(result.displayIcon).toBeUndefined();
    });

    test('should pick the most specific imgset when multiple match', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            generic: { image: 'nginx', display: { name: 'Generic Nginx', icon: 'mdi-web' } },
            specific: {
              image: 'harbor.example.com/library/nginx',
              display: { name: 'Harbor Nginx', icon: 'mdi-web-lock' },
            },
          },
        },
        container: {
          Id: '789',
          Image: 'harbor.example.com/library/nginx:1.25.0',
          Names: ['/mynginx'],
        },
        imageDetails: {
          Id: 'image789',
          RepoDigests: ['harbor.example.com/library/nginx@sha256:ghi789'],
        },
        parseImpl: (value) => {
          if (value === 'harbor.example.com/library/nginx:1.25.0')
            return { domain: 'harbor.example.com', path: 'library/nginx', tag: '1.25.0' };
          if (value === 'harbor.example.com/library/nginx')
            return { domain: 'harbor.example.com', path: 'library/nginx' };
          if (value === 'nginx') return { domain: undefined, path: 'nginx' };
          return { domain: undefined, path: value };
        },
        semverValue: { major: 1, minor: 25, patch: 0 },
        registryId: 'harbor',
      });

      const result = await docker.addImageDetailsToContainer(container);

      // The more specific imgset (harbor.example.com/library/nginx) should win
      expect(result.displayIcon).toBe('mdi-web-lock');
    });

    test('should validate configuration with imgset watchDigest and inspectTagPath', async () => {
      const config = {
        socket: '/var/run/docker.sock',
        imgset: {
          homeassistant: {
            image: 'ghcr.io/home-assistant/home-assistant',
            watch: {
              digest: 'true',
            },
            inspect: {
              tag: {
                path: 'Config/Labels/org.opencontainers.image.version',
              },
            },
          },
        },
      };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should use lookup image label for registry matching', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3',
          Names: ['/traefik'],
          Labels: { 'dd.registry.lookup.image': 'library/traefik' },
        },
        imageDetails: {
          RepoDigests: ['harbor.example.com/dockerhub-proxy/traefik@sha256:abc123'],
        },
        parseImpl: (value) => {
          if (value === 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3')
            return { domain: 'harbor.example.com', path: 'dockerhub-proxy/traefik', tag: 'v3.5.3' };
          if (value === 'library/traefik') return { path: 'library/traefik' };
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        semverValue: { major: 3, minor: 5, patch: 3 },
        registryState: harborHubState,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
      expect(result.image.registry.lookupImage).toBe('library/traefik');
      expect(result.image.name).toBe('library/traefik');
    });

    test('should support legacy lookup url label without crashing', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3',
          Names: ['/traefik'],
          Labels: { 'dd.registry.lookup.url': 'https://registry-1.docker.io' },
        },
        imageDetails: {
          RepoDigests: ['harbor.example.com/dockerhub-proxy/traefik@sha256:abc123'],
        },
        parsedImage: {
          domain: 'harbor.example.com',
          path: 'dockerhub-proxy/traefik',
          tag: 'v3.5.3',
        },
        semverValue: { major: 3, minor: 5, patch: 3 },
        registryState: harborHubState,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.lookupImage).toBe('https://registry-1.docker.io');
      expect(result.image.name).toBe('dockerhub-proxy/traefik');
    });

    test('should handle container with implicit docker hub image (no domain)', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'prom/prometheus:v3.8.0',
          Names: ['/prometheus'],
        },
        imageDetails: { RepoTags: ['prom/prometheus:v3.8.0'] },
        parsedImage: { domain: undefined, path: 'prom/prometheus', tag: 'v3.8.0' },
        validateImpl: () => ({
          id: '123',
          name: 'prometheus',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      // Verify parse was called
      expect(hMockParse).toHaveBeenCalledWith('prom/prometheus:v3.8.0');
    });

    test('should fail implicit docker hub image normalization when hub registry provider is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:1.25.5',
          Names: ['/hub-proof'],
        },
        parsedImage: { domain: undefined, path: 'library/nginx', tag: '1.25.5' },
        registryState: {},
        validateImpl: (containerCandidate) => {
          if (!containerCandidate.image.registry.url) {
            throw new Error('"image.registry.url" is required');
          }
          return containerCandidate;
        },
      });

      await expect(docker.addImageDetailsToContainer(container)).rejects.toThrow(
        '"image.registry.url" is required',
      );
    });

    test('should keep implicit docker hub image tracking when hub registry provider is available', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:1.25.5',
          Names: ['/hub-proof'],
        },
        parsedImage: { domain: undefined, path: 'library/nginx', tag: '1.25.5' },
        registryState: createHarborHubRegistryState(),
        validateImpl: (containerCandidate) => {
          if (!containerCandidate.image.registry.url) {
            throw new Error('"image.registry.url" is required');
          }
          return containerCandidate;
        },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
    });

    test('should handle container with SHA256 image', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: { RepoTags: ['nginx:latest'] },
        validateImpl: () => ({
          id: '123',
          name: 'test',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
    });

    test('should handle container with no repo tags but with repo digests', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['portainer/agent@sha256:abcdef123456'],
        },
        parseImpl: (value) => {
          if (value === 'portainer/agent') {
            return { domain: 'docker.io', path: 'portainer/agent' };
          }
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.name).toBe('portainer/agent');
      expect(result.image.tag.value).toBe('sha256:abcdef123456');
    });

    test('should handle container with no repo tags and no repo digests', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: { RepoTags: [], RepoDigests: [] },
        parsedImage: { path: 'sha256:abcdef123456', tag: 'unknown' },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should resolve digest-only image without container name (falsy containerName branch)', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: [],
        },
        imageDetails: { RepoTags: [], RepoDigests: [] },
        parsedImage: { path: 'sha256:abcdef123456', tag: 'unknown' },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should resolve digest-only image with RepoDigests containing @ separator', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:deadbeef7890',
          Names: ['/myapp'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['registry.example.com/myapp@sha256:deadbeef7890abcdef'],
        },
        parseImpl: (value) => {
          if (value === 'registry.example.com/myapp') {
            return { domain: 'registry.example.com', path: 'myapp' };
          }
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.name).toBe('myapp');
      expect(result.image.tag.value).toBe('sha256:deadbeef7890abcdef');
    });

    test('should default digest watching on for digest-pinned Docker Hub images without labels', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/portainer_agent'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['portainer/agent@sha256:abcdef123456'],
        },
        parseImpl: (value) => {
          if (value === 'portainer/agent') {
            return { domain: undefined, path: 'portainer/agent' };
          }
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        semverValue: null,
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.name).toBe('portainer/agent');
      expect(result.image.tag.value).toBe('sha256:abcdef123456');
      expect(result.image.digest.watch).toBe(true);
    });

    test('should recover the original tagged image reference from container inspect when RepoTags are missing', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn', 'debug']);
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Image: 'lscr.io/linuxserver/socket-proxy:latest',
        },
      });

      const container = await setupContainerDetailTest(docker, {
        container: {
          Id: 'socket-proxy-1',
          Image: 'sha256:deadbeef7890',
          Names: ['/docker-socket-proxy'],
        },
        imageDetails: {
          Id: 'image-socket-proxy',
          RepoTags: [],
          RepoDigests: ['lscr.io/linuxserver/socket-proxy@sha256:deadbeef7890abcdef'],
        },
        parseImpl: (value) => {
          if (value === 'lscr.io/linuxserver/socket-proxy:latest') {
            return {
              domain: 'lscr.io',
              path: 'linuxserver/socket-proxy',
              tag: 'latest',
            };
          }
          if (value === 'lscr.io/linuxserver/socket-proxy') {
            return {
              domain: 'lscr.io',
              path: 'linuxserver/socket-proxy',
            };
          }
          return {
            domain: 'docker.io',
            path: 'library/nginx',
            tag: '1.0.0',
          };
        },
        semverValue: null,
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.name).toBe('linuxserver/socket-proxy');
      expect(result.image.tag.value).toBe('latest');
      expect(result.image.digest.watch).toBe(true);
      expect(hMockParse).toHaveBeenCalledWith('lscr.io/linuxserver/socket-proxy:latest');
    });

    test('should keep digest watching enabled when Docker Hub image is recovered as latest from inspect', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn', 'debug']);
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Image: 'portainer/agent:latest',
        },
      });

      const container = await setupContainerDetailTest(docker, {
        container: {
          Id: 'portainer-agent-1',
          Image: 'sha256:deadbeef7890',
          Names: ['/portainer_agent'],
        },
        imageDetails: {
          Id: 'image-portainer-agent',
          RepoTags: [],
          RepoDigests: ['portainer/agent@sha256:deadbeef7890abcdef'],
        },
        parseImpl: (value) => {
          if (value === 'portainer/agent:latest') {
            return {
              domain: 'docker.io',
              path: 'portainer/agent',
              tag: 'latest',
            };
          }
          if (value === 'portainer/agent') {
            return {
              domain: 'docker.io',
              path: 'portainer/agent',
            };
          }
          return {
            domain: 'docker.io',
            path: 'library/nginx',
            tag: '1.0.0',
          };
        },
        semverValue: null,
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.name).toBe('portainer/agent');
      expect(result.image.tag.value).toBe('latest');
      expect(result.image.digest.watch).toBe(true);
      expect(hMockParse).toHaveBeenCalledWith('portainer/agent:latest');
    });

    test('should resolve digest-only image with RepoDigests lacking @ separator', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:cafebabe1234',
          Names: ['/oddimage'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['no-at-sign-here'],
        },
        parsedImage: { path: 'sha256:cafebabe1234', tag: 'unknown' },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should warn without a container name prefix when digest-only image has no names', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: [],
        },
        imageDetails: { RepoTags: [], RepoDigests: [] },
        parsedImage: { path: 'sha256:abcdef123456', tag: 'unknown' },
        validateImpl: (c) => c,
      });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot get a reliable tag for this image'),
      );
    });

    test('should fall back when repo digest is malformed and missing "@"', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['malformed-digest'],
        },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should prefix fallback digest when raw name does not start with sha256:', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'repo@sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['malformed-digest'],
        },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should warn for non-semver without digest watching', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:latest',
          Names: ['/test'],
        },
        semverValue: null,
        validateImpl: () => ({
          id: '123',
          name: 'test',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
    });

    test('should use inspect path semver when dd.inspect.tag.path is set', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: {
            'dd.inspect.tag.path': 'Config/Labels/org.opencontainers.image.version',
          },
        },
        imageDetails: {
          Config: {
            Labels: { 'org.opencontainers.image.version': '2.7.5' },
          },
        },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null, // will be overridden below
      });
      hMockTag.parse.mockImplementation((tag) => (tag === '2.7.5' ? { version: '2.7.5' } : null));

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.tag.value).toBe('2.7.5');
      expect(result.image.tag.semver).toBe(true);
    });

    test('should fall back to parsed image tag when inspect path is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: {
            'dd.inspect.tag.path': 'Config/Labels/org.opencontainers.image.version',
          },
        },
        imageDetails: { Config: { Labels: {} } },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.tag.value).toBe('latest');
      expect(result.image.tag.semver).toBe(false);
    });

    test('should return a clear error when image inspection fails', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = createDockerContainer({
        Image: 'ghcr.io/example/service:latest',
        Names: ['/service'],
      });
      mockImage.inspect.mockRejectedValue(new Error('inspect failed'));

      await expect(docker.addImageDetailsToContainer(container)).rejects.toThrow(
        'Unable to inspect image for container 123: inspect failed',
      );
    });
  });
});
