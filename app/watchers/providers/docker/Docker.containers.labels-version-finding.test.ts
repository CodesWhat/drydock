import { setupDockerWatcherContainerSuite } from './Docker.containers.test.helpers.js';
import { testable_getLabel } from './Docker.js';

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;
  let mockImage;
  let hRegistry: any;
  let hMockTag: any;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
    mockSchedule = state.mockSchedule;
    mockContainer = state.mockContainer;
    mockImage = state.mockImage;
  });

  beforeEach(async () => {
    hRegistry = await import('../../../registry/index.js');
    hMockTag = await import('../../../tag/index.js');
  });

  describe('Dual-prefix dd.*/wud.* label support', () => {
    test('should prefer dd.watch over wud.watch label', async () => {
      const containers = [
        {
          Id: 'dd-label-1',
          Labels: { 'dd.watch': 'true', 'wud.watch': 'false' },
          Names: ['/dd-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'dd-label-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      // dd.watch=true should override wud.watch=false
      expect(result).toHaveLength(1);
    });

    test('should fall back to wud.watch when dd.watch is not set', async () => {
      const containers = [
        {
          Id: 'wud-fallback-1',
          Labels: { 'wud.watch': 'true' },
          Names: ['/wud-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'wud-fallback-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
    });

    test('should prefer dd.tag.include over wud.tag.include label', async () => {
      const containers = [
        {
          Id: 'dd-tag-1',
          Labels: {
            'dd.watch': 'true',
            'dd.tag.include': String.raw`^v\d+`,
            'wud.tag.include': String.raw`^\d+`,
          },
          Names: ['/dd-tag-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'dd-tag-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      await docker.getContainers();

      // dd.tag.include should be preferred
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBe(
        String.raw`^v\d+`,
      );
    });

    describe('getLabel dual-prefix fallback for all label pairs', () => {
      const labelPairs = [
        ['dd.watch', 'wud.watch'],
        ['dd.tag.include', 'wud.tag.include'],
        ['dd.tag.exclude', 'wud.tag.exclude'],
        ['dd.tag.transform', 'wud.tag.transform'],
        ['dd.inspect.tag.path', 'wud.inspect.tag.path'],
        ['dd.hRegistry.lookup.image', 'wud.hRegistry.lookup.image'],
        ['dd.hRegistry.lookup.url', 'wud.hRegistry.lookup.url'],
        ['dd.watch.digest', 'wud.watch.digest'],
        ['dd.link.template', 'wud.link.template'],
        ['dd.display.name', 'wud.display.name'],
        ['dd.display.icon', 'wud.display.icon'],
        ['dd.trigger.include', 'wud.trigger.include'],
        ['dd.trigger.exclude', 'wud.trigger.exclude'],
        ['dd.group', 'wud.group'],
        ['dd.hook.pre', 'wud.hook.pre'],
        ['dd.hook.post', 'wud.hook.post'],
        ['dd.hook.pre.abort', 'wud.hook.pre.abort'],
        ['dd.hook.timeout', 'wud.hook.timeout'],
        ['dd.rollback.auto', 'wud.rollback.auto'],
        ['dd.rollback.window', 'wud.rollback.window'],
        ['dd.rollback.interval', 'wud.rollback.interval'],
      ];

      test.each(labelPairs)('should prefer %s over %s when both are present', (ddKey, wudKey) => {
        const labels = { [ddKey]: 'dd-value', [wudKey]: 'wud-value' };
        expect(testable_getLabel(labels, ddKey, wudKey)).toBe('dd-value');
      });

      test.each(labelPairs)('should fall back to %s when %s is absent', (ddKey, wudKey) => {
        const labels = { [wudKey]: 'legacy-value' };
        expect(testable_getLabel(labels, ddKey, wudKey)).toBe('legacy-value');
      });

      test.each(
        labelPairs,
      )('should return undefined when neither %s nor %s is set', (ddKey, wudKey) => {
        expect(testable_getLabel({}, ddKey, wudKey)).toBeUndefined();
      });
    });
  });

  describe('Version Finding', () => {
    test('should find new version using registry', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getTags).toHaveBeenCalledWith(container.image);
      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should include result publishedAt when registry can resolve publish date', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockResolvedValue('2026-03-10T10:00:00.000Z'),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImagePublishedAt).toHaveBeenCalledWith(container.image, '1.0.0');
      expect(result).toEqual({
        tag: '1.0.0',
        publishedAt: '2026-03-10T10:00:00.000Z',
      });
    });

    test('should resolve publishedAt using fallback tag expression when current tag is empty', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue([]),
        getImagePublishedAt: vi.fn().mockResolvedValue('2026-03-01T10:00:00.000Z'),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImagePublishedAt).toHaveBeenCalledWith(container.image, '');
      expect(result.publishedAt).toEqual('2026-03-01T10:00:00.000Z');
      expect(result.tag).toEqual('');
    });

    test('should ignore publish date values that are not strings', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockResolvedValue(new Date('2026-03-10T10:00:00.000Z')),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should continue when publish date lookup fails', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('publish date lookup failed'),
      );
    });

    test('should continue when publish date lookup fails and debug logger is unavailable', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should handle unsupported registry', async () => {
      const container = {
        image: {
          registry: { name: 'unknown' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      hRegistry.getState.mockReturnValue({ registry: {} });
      const mockLogChild = { error: vi.fn() };

      try {
        await docker.findNewVersion(container, mockLogChild);
      } catch (error) {
        expect(error.message).toContain('Unsupported Registry');
      }
    });

    test('should handle digest watching with v2 manifest', async () => {
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi
          .fn()
          .mockResolvedValueOnce({
            digest: 'sha256:def456',
            created: '2023-01-01',
            version: 2,
          })
          .mockResolvedValueOnce({
            digest: 'sha256:manifest123',
          }),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(2);
      expect(result.digest).toBe('sha256:def456');
      expect(result.created).toBe('2023-01-01');
    });

    test('should handle digest watching with v1 manifest using repo digest', async () => {
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
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBe('sha256:abc123');
    });

    test('should use tag candidate for digest lookup when digest watch is true and candidates exist', async () => {
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']),
        getImageManifestDigest: vi
          .fn()
          .mockResolvedValueOnce({
            digest: 'sha256:def456',
            created: '2023-01-01',
            version: 2,
          })
          .mockResolvedValueOnce({
            digest: 'sha256:manifest123',
          }),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      hMockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
      hMockTag.isGreater.mockImplementation((t2, t1) => {
        return t2 === '2.0.0' && t1 === '1.0.0';
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      // Should have used the tag candidate (2.0.0) for digest lookup
      expect(result.tag).toBe('2.0.0');
      expect(result.digest).toBe('sha256:def456');
    });

    test('should handle tag candidates with semver', async () => {
      const container = {
        includeTags: String.raw`^v\d+`,
        excludeTags: 'beta',
        transformTags: 's/v//',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['v1.0.0', 'v1.1.0', 'v2.0.0-beta', 'latest']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      hMockTag.parse.mockReturnValue({ major: 1, minor: 1, patch: 0 });
      hMockTag.isGreater.mockReturnValue(true);
      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getTags).toHaveBeenCalled();
    });

    test('should filter tags with different number of semver parts', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue([
          '1.2.1', // 3 parts, should be filtered out
          '1.3', // 2 parts, should be kept
          '1.1', // 2 parts, should be kept (but lower)
          '2', // 1 part, should be filtered out
        ]),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      // Mock isGreater to return true for 1.3 > 1.2
      hMockTag.isGreater.mockImplementation((t1, t2) => {
        if (t1 === '1.3' && t2 === '1.2') return true;
        return false;
      });

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.3' });
    });

    test('should ignore semver tags with mismatched numeric zero-padding style', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '5.1.4', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['20.04.1', '5.1.5', '5.1.4']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '5.1.4': 514,
        '5.1.5': 515,
        '20.04.1': 200401,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '5.1.5' });
    });

    test('should keep updates within inferred suffix family by default', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4-ls133' });
    });

    test('should keep current tag and warn when strict mode filters only cross-family higher tags', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.3-ls132']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4': 1241,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({
        tag: '1.2.3-ls132',
        noUpdateReason: expect.stringContaining(
          'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family of "1.2.3-ls132"',
        ),
      });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family of "1.2.3-ls132"',
        ),
      );
    });

    test('should allow cross-family updates in loose mode when no higher same-family tag exists', async () => {
      const container = {
        tagFamily: 'loose',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.3-ls132']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4': 1241,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4' });
    });

    test('should allow cross-family semver updates when tagFamily is loose', async () => {
      const container = {
        tagFamily: 'loose',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4' });
    });

    test('should fall back to strict mode when tagFamily is invalid', async () => {
      const container = {
        tagFamily: 'unsupported',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4-ls133' });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid tag family policy'),
      );
    });

    test('should log one-pass semver candidate filter counters in strict mode', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'v1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['latest', 'v1.0.0', 'v1.1.0', 'v2.0.0', '1.2.0']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        'v1.0.0': 100,
        'v1.1.0': 110,
        'v2.0.0': 200,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: 'v2.0.0' });
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          'Tag candidate filter counters (strict): input=5, prefix=3, semver=3, family=3, greater=2, output=2',
        ),
      );
    });

    test('should best-effort suggest semver tag when current tag is outside include filter', async () => {
      const container = {
        includeTags: '^1\\.',
        image: {
          registry: { name: 'hub' },
          tag: { value: '2.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['1.8.0', '1.9.0', '2.1.0']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.8.0': 180,
        '1.9.0': 190,
        '2.0.0': 200,
        '2.1.0': 210,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );
      hMockTag.parse.mockImplementation((version) => {
        const score = rank[version];
        if (!score) {
          return null;
        }
        return {
          major: Number.parseInt(version.split('.')[0], 10),
          minor: Number.parseInt(version.split('.')[1], 10),
          patch: Number.parseInt(version.split('.')[2], 10),
          prerelease: [],
        };
      });

      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.9.0' });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not match includeTags regex'),
      );
      expect(mockLogChild.debug).toHaveBeenCalledWith(expect.stringContaining('greater=skipped'));
    });

    test('should advise best semver tag when current tag is non-semver and includeTags filter is set', async () => {
      const container = {
        includeTags: String.raw`^\d+\.\d+`,
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['latest', 'rolling', '1.0.0', '2.0.0', '3.0.0']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.0.0': 100,
        '2.0.0': 200,
        '3.0.0': 300,
      };
      hMockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );
      hMockTag.parse.mockImplementation((version) =>
        rank[version] ? { major: 1, minor: 0, patch: 0 } : null,
      );

      const mockLogChild = {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({
        tag: '3.0.0',
        suggestedTag: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('is not semver but includeTags filter'),
      );
    });

    test('should not advise any tag when current tag is non-semver and no includeTags filter is set', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['latest', '1.0.0', '2.0.0']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      hMockTag.parse.mockReturnValue(null);

      const mockLogChild = {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const result = await docker.findNewVersion(container, mockLogChild);

      // Without includeTags, non-semver tags should not get any advice
      expect(result).toEqual({ tag: 'latest' });
    });

    test('should add suggestedTag for latest-tagged containers using highest stable semver', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['latest', '1.27.2', '1.27.3', '1.28.0-rc.1']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      hMockTag.parse.mockImplementation((tag) => {
        if (tag === '1.27.2') return { major: 1, minor: 27, patch: 2, prerelease: [] };
        if (tag === '1.27.3') return { major: 1, minor: 27, patch: 3, prerelease: [] };
        if (tag === '1.28.0-rc.1') return { major: 1, minor: 28, patch: 0, prerelease: ['rc', 1] };
        return null;
      });

      const result = await docker.findNewVersion(container as any, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });

      expect(result).toEqual({ tag: 'latest', suggestedTag: '1.27.3' });
    });

    test('should not add suggestedTag when latest-tagged container has no stable semver tags', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        normalizeImage: (img) => img,
        getTags: vi.fn().mockResolvedValue(['latest', 'nightly', '1.28.0-beta']),
      };
      hRegistry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      hMockTag.parse.mockImplementation((tag) => {
        if (tag === '1.28.0-beta') return { major: 1, minor: 28, patch: 0, prerelease: ['beta'] };
        return null;
      });

      const result = await docker.findNewVersion(container as any, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });

      expect(result).toEqual({ tag: 'latest' });
    });
  });
});
