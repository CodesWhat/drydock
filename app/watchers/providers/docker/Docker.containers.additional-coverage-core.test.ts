import mockParse from 'parse-docker-image-name';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as mockPrometheus from '../../../prometheus/watcher.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import * as mockTag from '../../../tag/index.js';
import { getDockerWatcherRegistryId, getDockerWatcherSourceKey } from './container-init.js';
import {
  createDeviceCodeResponse,
  createDeviceFlowConfig,
  createDockerContainer,
  createDockerOidcContext,
  createDockerOidcStateAdapter,
  createHaParseMock,
  createHarborHubRegistryState,
  createMockLog,
  createMockLogWithChild,
  createOidcConfig,
  createTokenResponse,
  mockAxios,
  mockDdEnvVars,
  mockDetectSourceRepoFromImageMetadata,
  mockGetFullReleaseNotesForContainer,
  mockResolveSourceRepoForContainer,
  mockToContainerReleaseNotes,
  setupContainerDetailTest,
  setupDockerWatcherContainerSuite,
} from './Docker.containers.test.helpers.js';
import {
  testable_filterBySegmentCount,
  testable_filterRecreatedContainerAliases,
  testable_getContainerDisplayName,
  testable_getContainerName,
  testable_getCurrentPrefix,
  testable_getFirstDigitIndex,
  testable_getImageForRegistryLookup,
  testable_getImageReferenceCandidatesFromPattern,
  testable_getImgsetSpecificity,
  testable_getInspectValueByPath,
  testable_getLabel,
  testable_getOldContainers,
  testable_normalizeConfigNumberValue,
  testable_normalizeContainer,
  testable_pruneOldContainers,
  testable_shouldUpdateDisplayNameFromContainerName,
} from './Docker.js';
import * as maintenance from './maintenance.js';

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;
  let mockImage;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
    mockSchedule = state.mockSchedule;
    mockContainer = state.mockContainer;
    mockImage = state.mockImage;
  });

  describe('Additional Coverage - safeRegExp', () => {
    test('should warn when includeTags regex is invalid', async () => {
      const container = {
        includeTags: '[invalid',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const result = await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern'));
      expect(result.tag).toBe('1.0.0');
    });

    test('should warn when excludeTags regex is invalid', async () => {
      const container = {
        excludeTags: '(unclosed',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern'));
    });
  });

  describe('Additional Coverage - filterByCurrentPrefix', () => {
    test('should warn when no tags match prefix', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'v1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found with existing prefix'),
      );
    });

    test('should warn when no tags start with a number', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['latest', 'stable']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found starting with a number'),
      );
    });
  });

  describe('Additional Coverage - getTagCandidates empty', () => {
    test('should warn when no tags after include filter', async () => {
      const container = {
        includeTags: '^nonexistent$',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found after filtering'),
      );
    });
  });

  describe('Additional Coverage - getSwarmServiceLabels', () => {
    test('should return empty when getService is not a function', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      docker.dockerApi.getService = 'not-a-function';
      expect(await docker.getSwarmServiceLabels('svc1', 'c1')).toEqual({});
      expect(docker.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('does not support getService'),
      );
    });

    test('should log debug when service has no labels', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Spec: {} }),
      });
      expect(await docker.getSwarmServiceLabels('svc1', 'c1')).toEqual({});
      expect(docker.log.debug).toHaveBeenCalledWith(expect.stringContaining('has no labels'));
    });

    test('should log dd/wud label summary as none when labels are present but none are dd/wud', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: { team: 'ops' },
            TaskTemplate: {
              ContainerSpec: {
                Labels: { env: 'prod' },
              },
            },
          },
        }),
      });

      const labels = await docker.getSwarmServiceLabels('svc1', 'c1');

      expect(labels).toEqual({ team: 'ops', env: 'prod' });
      expect(docker.log.debug).toHaveBeenCalledWith(expect.stringContaining('deploy labels=none'));
    });

    test('getEffectiveContainerLabels should fallback to empty container labels object', async () => {
      const labels = await docker.getEffectiveContainerLabels({}, new Map());
      expect(labels).toEqual({});
    });

    test('getEffectiveContainerLabels should merge container labels when cached service labels are undefined', async () => {
      const serviceId = 'svc-1';
      const serviceLabelsCache = new Map([[serviceId, Promise.resolve(undefined as any)]]);

      const labels = await docker.getEffectiveContainerLabels(
        {
          Id: 'container-1',
          Labels: {
            'com.docker.swarm.service.id': serviceId,
            'dd.watch': 'true',
          },
        },
        serviceLabelsCache,
      );

      expect(labels).toEqual({
        'com.docker.swarm.service.id': serviceId,
        'dd.watch': 'true',
      });
    });
  });

  describe('Additional Coverage - getMatchingImgsetConfiguration', () => {
    test('should return undefined when no imgset configured', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      expect(
        docker.getMatchingImgsetConfiguration({ path: 'library/nginx', domain: 'docker.io' }),
      ).toBeUndefined();
    });

    test('should break ties by alphabetical name', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: {
          zebra: { image: 'library/nginx', display: { name: 'Z' } },
          alpha: { image: 'library/nginx', display: { name: 'A' } },
        },
      });
      mockParse.mockImplementation((v) =>
        v === 'library/nginx'
          ? { path: 'library/nginx' }
          : { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      );
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeDefined();
      expect(result.name).toBe('alpha');
    });

    test('should keep first match when later candidate is not better', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: {
          alpha: { image: 'library/nginx' },
          zebra: { image: 'library/nginx' },
        },
      });

      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('alpha');
    });
  });

  describe('Additional Coverage - safeRegExp max length', () => {
    test('should warn when regex pattern exceeds max length', async () => {
      const longPattern = 'a'.repeat(1025);
      const container = {
        includeTags: longPattern,
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum length'));
    });

    test('should warn when exclude regex exceeds max length', async () => {
      const longPattern = 'b'.repeat(1025);
      const container = {
        excludeTags: longPattern,
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum length'));
    });
  });

  describe('Additional Coverage - filterBySegmentCount no numeric part', () => {
    test('should return all tags when current tag has no numeric part', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: true },
          digest: { watch: false },
        },
        includeTags: '.*',
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['latest', 'stable', '1.0.0']) } },
      });
      // Make transform return 'nonnumeric' for the current tag to hit numericPart === null
      mockTag.transform.mockImplementation((_transform, tag) =>
        tag === 'latest' ? 'nonnumeric' : tag,
      );
      mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      // Should not crash; tags pass through
      expect(logChild.error).not.toHaveBeenCalled();
    });
  });

  describe('Additional Coverage - normalizeContainer no registry', () => {
    test('should set registry name to unknown when no registry provider found', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'custom.registry/myimage:1.0.0', Names: ['/myimage'] },
        parsedImage: { domain: 'custom.registry', path: 'myimage', tag: '1.0.0' },
        registryState: {},
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.registry.name).toBe('unknown');
    });
  });

  describe('Additional Coverage - v1 manifest digest uses repo digest', () => {
    test('should set digest value from repo digest for v1 manifests', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      registry.getState.mockReturnValue({ registry: { hub: mockRegistry } });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBe('sha256:abc123');
    });

    test('should set digest value to undefined when repo digest is missing', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: undefined },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      registry.getState.mockReturnValue({ registry: { hub: mockRegistry } });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBeUndefined();
    });
  });

  describe('Additional Coverage - getMatchingImgsetConfiguration with no image pattern', () => {
    test('should skip imgset entries without image/match key', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      // Set imgset directly to bypass Joi validation requiring image field
      docker.configuration.imgset = {
        noimage: { display: { name: 'No Image Entry' } },
      };
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('Additional Coverage - getSwarmServiceLabels with dd labels', () => {
    test('should log debug with dd label names from service', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const logMock = createMockLog(['debug', 'warn', 'info']);
      docker.log = logMock;
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: { 'dd.watch': 'true', 'dd.tag.include': '^v' },
            TaskTemplate: { ContainerSpec: { Labels: { 'wud.display.name': 'Test' } } },
          },
        }),
      });
      const labels = await docker.getSwarmServiceLabels('svc1', 'c1');
      expect(labels['dd.watch']).toBe('true');
      expect(labels['wud.display.name']).toBe('Test');
      expect(logMock.debug).toHaveBeenCalledWith(
        expect.stringContaining('deploy labels=dd.watch,dd.tag.include'),
      );
    });
  });

  describe('Additional Coverage - getImageForRegistryLookup branches', () => {
    test('should handle lookup image as hostname only (no slash)', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'myimage:1.0.0',
          Names: ['/myimage'],
          Labels: { 'dd.registry.lookup.image': 'myregistry.example.com' },
        },
        imageDetails: { RepoDigests: ['myimage@sha256:abc123'] },
        parsedImage: { domain: undefined, path: 'library/myimage', tag: '1.0.0' },
        parseImpl: (value) => {
          if (value === 'myimage:1.0.0')
            return { domain: undefined, path: 'library/myimage', tag: '1.0.0' };
          if (value === 'myregistry.example.com')
            return { path: 'myregistry.example.com', domain: undefined };
          return { domain: undefined, path: value };
        },
        registryState: harborHubState,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result).toBeDefined();
    });

    test('should handle lookup image with empty parsed path', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'myimage:1.0.0',
          Names: ['/myimage'],
          Labels: { 'dd.registry.lookup.image': 'something' },
        },
        imageDetails: { RepoDigests: ['myimage@sha256:abc123'] },
        parseImpl: (value) => {
          if (value === 'myimage:1.0.0')
            return { domain: undefined, path: 'library/myimage', tag: '1.0.0' };
          if (value === 'something') return { path: undefined, domain: undefined };
          return { domain: undefined, path: value };
        },
        registryState: harborHubState,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result).toBeDefined();
    });
  });

  describe('Additional Coverage - Docker Hub digest watch warning', () => {
    test('should warn about throttling when watching digest on Docker Hub with explicit label', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'docker.io/library/nginx:latest',
          Names: ['/nginx'],
          Labels: { 'dd.watch.digest': 'true' },
        },
        imageDetails: { RepoDigests: ['nginx@sha256:abc123'] },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: 'latest' },
        semverValue: null,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.digest.watch).toBe(true);
    });
  });

  describe('Additional Coverage - inspectTagPath edge cases', () => {
    test('should handle inspect path returning empty string value', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: { 'dd.inspect.tag.path': 'Config/Labels/version' },
        },
        imageDetails: { Config: { Labels: { version: '   ' } } },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });
      mockTag.transform.mockImplementation((_transform, value) => value);
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });

    test('should handle inspect path with null intermediate value', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: { 'dd.inspect.tag.path': 'Config/NonExistent/deep' },
        },
        imageDetails: { Config: {} },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });

    test('should default to latest when parsed image tag is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service',
          Names: ['/service'],
          Labels: {},
        },
        imageDetails: {},
        parsedImage: { domain: 'ghcr.io', path: 'example/service' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });
  });

  describe('Additional Coverage - imgset pattern matching edge cases', () => {
    test('should handle imgset with empty image pattern', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.configuration.imgset = { weird: { image: '   ' } };
      mockParse.mockReturnValue({ path: undefined });
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeUndefined();
    });

    test('should return -1 specificity when parsedImage has no path', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: { test: { image: 'library/nginx' } },
      });
      mockParse.mockImplementation((v) => (v === 'library/nginx' ? { path: 'library/nginx' } : {}));
      const result = docker.getMatchingImgsetConfiguration({ path: undefined, domain: undefined });
      expect(result).toBeUndefined();
    });

    test('helper should return empty candidates for blank pattern', () => {
      expect(testable_getImageReferenceCandidatesFromPattern('   ')).toEqual([]);
    });

    test('helper should fallback to normalized pattern when parsed pattern has no path', () => {
      mockParse.mockReturnValue({ path: undefined });
      expect(testable_getImageReferenceCandidatesFromPattern('docker.io')).toEqual(['docker.io']);
    });

    test('helper should fallback to normalized pattern when parser throws', () => {
      mockParse.mockImplementation(() => {
        throw new Error('invalid pattern');
      });
      expect(testable_getImageReferenceCandidatesFromPattern('INVALID[')).toEqual(['invalid[']);
    });

    test('helper should return -1 specificity when pattern produces no candidates', () => {
      expect(
        testable_getImgsetSpecificity('   ', { path: 'library/nginx', domain: 'docker.io' }),
      ).toBe(-1);
    });

    test('helper should avoid array includes for candidate membership checks', () => {
      mockParse.mockReturnValue({ path: 'library/nginx', domain: 'docker.io' });
      const includesSpy = vi.spyOn(Array.prototype, 'includes');
      const beforeCallCount = includesSpy.mock.calls.length;
      const specificity = testable_getImgsetSpecificity('library/nginx', {
        path: 'library/nginx',
        domain: 'docker.io',
      });
      const callDelta = includesSpy.mock.calls.length - beforeCallCount;
      includesSpy.mockRestore();

      expect(specificity).toBeGreaterThan(0);
      expect(callDelta).toBe(0);
    });
  });
});
