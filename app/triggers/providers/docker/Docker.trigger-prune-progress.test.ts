import log from '../../../log/index.js';
import {
  configurationValid,
  createEchoNormalizeRegistry,
  createMockLog,
  createPruneContainer,
  createPruneDockerApi,
  createSbomResult,
  createSecurityConfiguration,
  createSecurityScanResult,
  createSignatureVerificationResult,
  createTriggerContainer,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
  stubTriggerFlow,
} from './Docker.test.helpers.js';

registerCommonDockerBeforeEach();
const {
  mockAuditCounterInc,
  mockGenerateImageSbom,
  mockGetSecurityConfiguration,
  mockScanImageForVulnerabilities,
  mockVerifyImageSignature,
} = getDockerTestMocks();

// --- trigger ---

test('trigger should not throw when all is ok', async () => {
  await expect(
    docker.trigger({
      watcher: 'test',
      id: '123456789',
      Name: '/container-name',
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: '1.0.0' },
      },
      updateKind: { remoteValue: '4.5.6' },
    }),
  ).resolves.toBeUndefined();
});

test('mustTrigger should reject containers renamed with -old unix timestamp suffix', () => {
  expect(
    docker.mustTrigger(createTriggerContainer({ name: 'container-name-old-1773933154786' })),
  ).toBe(false);
});

test('mustTrigger should allow containers without rollback suffix', () => {
  expect(docker.mustTrigger(createTriggerContainer({ name: 'my-container' }))).toBe(true);
});

test('trigger should not throw in dryrun mode', async () => {
  docker.configuration = { ...configurationValid, dryrun: true };
  docker.log = log;
  await expect(
    docker.trigger(createTriggerContainer({ name: 'test-container' })),
  ).resolves.toBeUndefined();
});

test('trigger should use waitContainerRemoved when AutoRemove is true', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: false };
  docker.log = log;
  const { waitSpy } = stubTriggerFlow({ running: true, autoRemove: true });

  await docker.trigger(createTriggerContainer());

  expect(waitSpy).toHaveBeenCalled();
});

test('trigger should prune old image by tag after non-dryrun update', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  const { removeImageSpy } = stubTriggerFlow();

  await docker.trigger(createTriggerContainer());

  expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should prune old image by digest repo after non-dryrun update', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  const { removeImageSpy } = stubTriggerFlow();

  await docker.trigger(
    createTriggerContainer({
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: 'latest' },
        digest: { repo: 'sha256:olddigest' },
      },
      updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }),
  );

  expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should catch error when removing digest image fails', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  stubTriggerFlow();
  vi.spyOn(docker, 'removeImage').mockRejectedValue(new Error('remove failed'));

  // Should not throw
  await docker.trigger(
    createTriggerContainer({
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: 'latest' },
        digest: { repo: 'sha256:olddigest' },
      },
      updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }),
  );
});

test('trigger should not throw when container does not exist', async () => {
  docker.configuration = { ...configurationValid, dryrun: false };
  docker.log = log;
  vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(null);

  await expect(
    docker.trigger(createTriggerContainer({ name: 'test-container' })),
  ).resolves.toBeUndefined();
});

test('trigger should throw an explicit error when registry manager is unknown', async () => {
  await expect(
    docker.trigger(
      createTriggerContainer({
        image: {
          name: 'test/test',
          registry: { name: 'custom.local', url: '' },
          tag: { value: '1.0.0' },
        },
      }),
    ),
  ).rejects.toThrowError('Unsupported registry manager "custom.local"');
});

test('trigger should throw an explicit error when registry manager is misconfigured', async () => {
  const registryStore = await import('../../../registry/index.js');
  const baseState = registryStore.getState();
  vi.spyOn(registryStore, 'getState').mockReturnValue({
    ...baseState,
    registry: {
      ...baseState.registry,
      hub: {
        getImageFullName: vi.fn(
          (image, tagOrDigest) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
        ),
      },
    },
  } as any);

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    /Registry manager "hub" is misconfigured.*getAuthPull/,
  );
});

test('trigger should use anonymous registry mode when registry URL is provided', async () => {
  stubTriggerFlow({ running: true });
  const executeSelfUpdateSpy = vi.spyOn(docker, 'executeSelfUpdate').mockResolvedValue(false);
  const maybeNotifySelfUpdateSpy = vi
    .spyOn(docker, 'maybeNotifySelfUpdate')
    .mockResolvedValue(undefined);

  await expect(
    docker.trigger(
      createTriggerContainer({
        image: {
          name: 'drydock',
          registry: { name: 'custom.local', url: 'http://localhost:5000/v2' },
          tag: { value: 'good' },
        },
        updateKind: { kind: 'tag', remoteValue: 'bad' },
      }),
    ),
  ).resolves.toBeUndefined();

  expect(maybeNotifySelfUpdateSpy).toHaveBeenCalled();
  expect(executeSelfUpdateSpy).toHaveBeenCalled();
  const [contextArg] = executeSelfUpdateSpy.mock.calls[0];
  expect(contextArg.newImage).toBe('localhost:5000/drydock:bad');
  expect(contextArg.auth).toBeUndefined();
});

test('trigger should block update when security scan is blocked', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({
      status: 'blocked',
      blockingCount: 2,
      summary: {
        unknown: 0,
        low: 0,
        medium: 0,
        high: 2,
        critical: 0,
      },
      vulnerabilities: [
        { id: 'CVE-1', severity: 'HIGH' },
        { id: 'CVE-2', severity: 'HIGH' },
      ],
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan blocked update',
  );

  expect(mockScanImageForVulnerabilities).toHaveBeenCalled();
  // Scan now runs inside executeContainerUpdate (post-pull hook), so the executor IS entered
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should block update when security scan errors', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({
      status: 'error',
      error: 'Trivy command failed',
    }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan failed: Trivy command failed',
  );
});

test('trigger should continue update when security scan passes', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockScanImageForVulnerabilities).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should continue update when signature verification passes', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: {
          command: 'cosign',
          timeout: 60000,
          key: '',
          identity: '',
          issuer: '',
        },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(createSignatureVerificationResult());
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockVerifyImageSignature).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should block update when signature verification is unverified', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: {
          command: 'cosign',
          timeout: 60000,
          key: '',
          identity: '',
          issuer: '',
        },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({
      status: 'unverified',
      signatures: 0,
      error: 'no matching signatures',
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed',
  );

  expect(mockVerifyImageSignature).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).not.toHaveBeenCalled();
});

test('trigger should generate sbom when enabled', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: {
        enabled: true,
        formats: ['spdx-json', 'cyclonedx-json'],
      },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({
      formats: ['spdx-json', 'cyclonedx-json'],
      documents: {
        'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
        'cyclonedx-json': { bomFormat: 'CycloneDX' },
      },
    }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockGenerateImageSbom).toHaveBeenCalledWith(
    expect.objectContaining({
      formats: ['spdx-json', 'cyclonedx-json'],
    }),
  );
});

test('trigger should continue update when sbom generation fails', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: {
        enabled: true,
        formats: ['spdx-json'],
      },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({
      status: 'error',
      documents: {},
      error: 'trivy unavailable',
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockGenerateImageSbom).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should use fallback message when signature verification fails without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({ status: 'unverified', signatures: 0, error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed: no valid signatures found',
  );
});

test('trigger should use security-signature-failed action when signature status is error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({ status: 'error', signatures: 0, error: 'cosign crashed' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed: cosign crashed',
  );

  expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'security-signature-failed' });
});

test('trigger should use fallback message when sbom generation fails without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: { enabled: true, formats: ['spdx-json'] },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({ status: 'error', documents: {}, error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockAuditCounterInc).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'security-sbom-failed' }),
  );
});

test('trigger should use fallback message when security scan errors without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({ status: 'error', error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan failed: unknown scanner error',
  );
});

test('persistSecurityState should warn when container store update fails', async () => {
  const storeContainer = await import('../../../store/container.js');
  storeContainer.updateContainer.mockImplementationOnce(() => {
    throw new Error('store unavailable');
  });
  const logContainer = createMockLog('warn');

  await docker.persistSecurityState(
    createTriggerContainer(),
    { scan: createSecurityScanResult() },
    logContainer,
  );

  expect(logContainer.warn).toHaveBeenCalledWith(
    expect.stringContaining('Unable to persist security state (store unavailable)'),
  );
});

test('persistSecurityState should merge with existing security state from store', async () => {
  const storeContainer = await import('../../../store/container.js');
  storeContainer.getContainer.mockReturnValue({
    id: '123456789',
    security: {
      scan: createSecurityScanResult(),
    },
  });
  const logContainer = createMockLog('warn');

  await docker.persistSecurityState(
    createTriggerContainer(),
    { signature: createSignatureVerificationResult() },
    logContainer,
  );

  expect(storeContainer.updateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      security: expect.objectContaining({
        scan: expect.any(Object),
        signature: expect.any(Object),
      }),
    }),
  );
});

// --- triggerBatch ---

test('triggerBatch should call trigger for each container', async () => {
  const triggerSpy = vi.spyOn(docker, 'trigger').mockResolvedValue();
  const containers = [{ name: 'c1' }, { name: 'c2' }];
  await docker.triggerBatch(containers);
  expect(triggerSpy).toHaveBeenCalledTimes(2);
  expect(triggerSpy).toHaveBeenCalledWith({ name: 'c1' });
  expect(triggerSpy).toHaveBeenCalledWith({ name: 'c2' });
});

test('triggerBatch should limit concurrent container updates to 3', async () => {
  const containers = Array.from({ length: 8 }, (_, index) => ({ name: `c${index}` }));
  let inFlight = 0;
  let maxInFlight = 0;
  const triggerSpy = vi.spyOn(docker, 'trigger').mockImplementation(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
  });

  await docker.triggerBatch(containers);

  expect(triggerSpy).toHaveBeenCalledTimes(containers.length);
  expect(maxInFlight).toBeLessThanOrEqual(3);
});

// --- pruneImages (parametric: exclusion filters) ---

describe('pruneImages exclusion filters', () => {
  test.each([
    {
      scenario: 'should exclude the current tag when updateKind is digest',
      images: [
        { Id: 'image-current', RepoTags: ['ecr.example.com/repo:nginx-prod'] },
        { Id: 'image-other', RepoTags: ['ecr.example.com/repo:other-tag'] },
      ],
      container: createPruneContainer({
        image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: 'nginx-prod' } },
        updateKind: {
          kind: 'digest',
          localValue: 'sha256:olddigest',
          remoteValue: 'sha256:newdigest',
        },
      }),
      expectedGetImageCalls: 1,
      expectedGetImageArgs: ['image-other'],
    },
    {
      scenario: 'should not exclude current tag when updateKind is tag',
      images: [
        { Id: 'image-current', RepoTags: ['ecr.example.com/repo:1.0.0'] },
        { Id: 'image-other', RepoTags: ['ecr.example.com/repo:0.9.0'] },
      ],
      container: createPruneContainer(),
      expectedGetImageCalls: 1,
      expectedGetImageArgs: ['image-other'],
    },
  ])('$scenario', async ({ images, container, expectedGetImageCalls, expectedGetImageArgs }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), container, log);

    expect(mockDockerApi.getImage).toHaveBeenCalledTimes(expectedGetImageCalls);
    for (const arg of expectedGetImageArgs) {
      expect(mockDockerApi.getImage).toHaveBeenCalledWith(arg);
    }
  });
});

describe('pruneImages should not prune excluded images', () => {
  test.each([
    {
      scenario: 'images from different registries',
      images: [{ Id: 'image-diff-registry', RepoTags: ['other-registry.com/repo:1.0.0'] }],
      registryName: 'other-reg',
    },
    {
      scenario: 'images with different names',
      images: [{ Id: 'image-diff-name', RepoTags: ['ecr.example.com/other-repo:0.9.0'] }],
      registryName: 'ecr',
    },
    {
      scenario: 'images matching remoteValue',
      images: [{ Id: 'image-remote', RepoTags: ['ecr.example.com/repo:2.0.0'] }],
      registryName: 'ecr',
    },
  ])('$scenario', async ({ images, registryName }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(
      mockDockerApi,
      createEchoNormalizeRegistry(registryName),
      createPruneContainer(),
      log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
  });
});

describe('pruneImages edge cases', () => {
  test.each([
    {
      scenario: 'should exclude images without RepoTags (null)',
      images: [{ Id: 'image-no-tags', RepoTags: null }],
    },
    {
      scenario: 'should exclude images without RepoTags (empty)',
      images: [{ Id: 'image-empty-tags', RepoTags: [] }],
    },
    {
      scenario: 'should exclude images without RepoTags (null and empty)',
      images: [
        { Id: 'image-no-tags', RepoTags: null },
        { Id: 'image-empty-tags', RepoTags: [] },
      ],
    },
  ])('$scenario', async ({ images }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(
      mockDockerApi,
      { normalizeImage: vi.fn() },
      createPruneContainer(),
      log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
  });

  test('should warn when error occurs during pruning', async () => {
    const mockDockerApi = {
      listImages: vi.fn().mockRejectedValue(new Error('list failed')),
    };
    const logContainer = createMockLog('info', 'warn');

    await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

    expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('list failed'));
  });

  test('should normalize listed images when parser returns no domain', async () => {
    const mockDockerApi = createPruneDockerApi([
      { Id: 'image-no-domain', RepoTags: ['repo:0.9.0'] },
    ]);
    const normalizeImage = vi.fn((img) => ({
      ...img,
      registry: { name: 'ecr', url: img.registry.url || '' },
      name: img.name,
      tag: { value: img.tag.value },
    }));

    await docker.pruneImages(
      mockDockerApi,
      { normalizeImage },
      createPruneContainer(),
      createMockLog('info', 'warn'),
    );

    expect(normalizeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: expect.objectContaining({ url: '' }),
      }),
    );
  });
});

// --- Duplicate pruneImages tests (longer-form, kept for backward compatibility) ---

test('pruneImages should exclude images with different names', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-different-name', RepoTags: ['ecr.example.com/different-repo:1.0.0'] },
  ]);
  const containerTagUpdate = createPruneContainer();

  await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude candidate image (remoteValue)', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-candidate', RepoTags: ['ecr.example.com/repo:2.0.0'] },
  ]);
  const containerTagUpdate = createPruneContainer();

  await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images without RepoTags', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-no-tags', RepoTags: [] },
    { Id: 'image-null-tags' },
  ]);

  await docker.pruneImages(mockDockerApi, { normalizeImage: vi.fn() }, createPruneContainer(), log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images with different registry', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-diff-registry', RepoTags: ['other-registry.io/repo:0.8.0'] },
  ]);

  await docker.pruneImages(
    mockDockerApi,
    createEchoNormalizeRegistry('other-registry'),
    createPruneContainer(),
    log,
  );

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should warn when error occurs during pruning', async () => {
  const mockDockerApi = {
    listImages: vi.fn().mockRejectedValue(new Error('list failed')),
  };
  const logContainer = createMockLog('info', 'warn');

  await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

  expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('list failed'));
});

// --- getNewImageFullName ---

test('getNewImageFullName should use tag value for digest updates', () => {
  const mockRegistry = {
    getImageFullName: (image, tagOrDigest) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
  };
  const containerDigest = {
    image: {
      name: 'test/test',
      tag: { value: 'nginx-prod' },
      registry: { url: 'my-registry' },
    },
    updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
  };
  const result = docker.getNewImageFullName(mockRegistry, containerDigest);
  expect(result).toBe('my-registry/test/test:nginx-prod');
});

test('getNewImageFullName should fall back to tag value when remoteValue is undefined', () => {
  const mockRegistry = {
    getImageFullName: (image, tagOrDigest) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
  };
  const containerUnknown = {
    image: {
      name: 'test/test',
      tag: { value: 'latest' },
      registry: { url: 'my-registry' },
    },
    updateKind: { kind: 'unknown', remoteValue: undefined },
  };
  const result = docker.getNewImageFullName(mockRegistry, containerUnknown);
  expect(result).toBe('my-registry/test/test:latest');
});

// --- createPullProgressLogger ---

test('createPullProgressLogger should throttle duplicate snapshots within interval', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');

  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 50, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);

  // Immediate repeat with same data should be throttled
  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 50, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);

  // Different data but within interval should still be throttled
  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 75, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);
});

test('createPullProgressLogger should handle null/undefined progressEvent', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
  logger.onProgress(null);
  logger.onProgress(undefined);
  expect(logContainer.debug).not.toHaveBeenCalled();
});

test('createPullProgressLogger onDone should force log regardless of interval', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
  logger.onProgress({
    status: 'Downloading',
    id: 'l1',
    progressDetail: { current: 50, total: 100 },
  });
  logger.onDone({ status: 'Download complete', id: 'l1' });
  expect(logContainer.debug).toHaveBeenCalledTimes(2);
});

test('createPullProgressLogger should use default status when progress event has no status', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');

  logger.onProgress({});

  expect(logContainer.debug).toHaveBeenCalledWith('Pull progress for test:1.0: progress');
});

// --- formatPullProgress ---

test('formatPullProgress should return string progress when progressDetail is missing', () => {
  expect(docker.formatPullProgress({ progress: '[==> ] 50%' })).toBe('[==> ] 50%');
});

test('formatPullProgress should return undefined when no progress data', () => {
  expect(docker.formatPullProgress({ status: 'Waiting' })).toBeUndefined();
  expect(docker.formatPullProgress({})).toBeUndefined();
});

test('formatPullProgress should return formatted percentage', () => {
  expect(docker.formatPullProgress({ progressDetail: { current: 50, total: 200 } })).toBe(
    '50/200 (25%)',
  );
});
