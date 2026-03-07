import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import { createSecurityHandlers } from './security.js';

const AUTH = { username: 'user', password: 'token' };
const CURRENT_IMAGE = 'my-registry/test/app:1.2.3';
const UPDATE_IMAGE = 'my-registry/test/app:2.0.0';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    watcher: 'local',
    image: {
      registry: { name: 'hub', url: 'my-registry' },
      name: 'test/app',
      tag: { value: '1.2.3' },
    },
    updateAvailable: true,
    result: { tag: '2.0.0' },
    security: {},
    ...overrides,
  };
}

function createScanResult(overrides: Record<string, unknown> = {}) {
  return {
    scanner: 'trivy',
    image: CURRENT_IMAGE,
    scannedAt: '2026-03-04T12:00:00.000Z',
    status: 'passed',
    blockSeverities: [],
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: [],
    ...overrides,
  };
}

function createSignatureResult(image: string, overrides: Record<string, unknown> = {}) {
  return {
    verifier: 'cosign',
    image,
    verifiedAt: '2026-03-04T12:01:00.000Z',
    status: 'verified',
    keyless: true,
    signatures: 1,
    ...overrides,
  };
}

function createSbomResult(image: string, overrides: Record<string, unknown> = {}) {
  return {
    generator: 'trivy',
    image,
    generatedAt: '2026-03-04T12:02:00.000Z',
    status: 'generated',
    formats: ['spdx-json'],
    documents: {
      'spdx-json': { SPDXID: `SPDXRef-${image}` },
    },
    ...overrides,
  };
}

function createHarness(
  options: {
    container?: Record<string, unknown>;
    securityConfiguration?: {
      enabled: boolean;
      scanner: string;
      signature: { verify: boolean };
      sbom: { enabled: boolean; formats: ('spdx-json' | 'cyclonedx-json')[] };
    };
  } = {},
) {
  const container = options.container ?? createContainer();
  const securityConfiguration = options.securityConfiguration ?? {
    enabled: true,
    scanner: 'trivy',
    signature: { verify: false },
    sbom: { enabled: false, formats: [] as ('spdx-json' | 'cyclonedx-json')[] },
  };

  const storeContainer = {
    getContainer: vi.fn(() => container),
    updateContainer: vi.fn((value) => value),
  };
  const deps = {
    storeContainer,
    getSecurityConfiguration: vi.fn(() => securityConfiguration),
    SECURITY_SBOM_FORMATS: ['spdx-json', 'cyclonedx-json'] as const,
    generateImageSbom: vi.fn(),
    scanImageForVulnerabilities: vi.fn(),
    verifyImageSignature: vi.fn(),
    emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
    fullName: vi.fn(() => 'local_nginx'),
    broadcastScanStarted: vi.fn(),
    broadcastScanCompleted: vi.fn(),
    redactContainerRuntimeEnv: vi.fn((value) => value),
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : 'unknown error',
    ),
    getContainerImageFullName: vi.fn((targetContainer: any, tagOverride?: string) =>
      tagOverride
        ? `my-registry/${targetContainer.image.name}:${tagOverride}`
        : `my-registry/${targetContainer.image.name}:${targetContainer.image.tag.value}`,
    ),
    getContainerRegistryAuth: vi.fn(async () => AUTH),
    getTrivyDatabaseStatus: vi.fn(async () => ({
      updatedAt: '2026-03-04T11:55:00.000Z',
    })),
    updateDigestScanCache: vi.fn(),
    log: { info: vi.fn() },
  };

  return {
    deps,
    storeContainer,
    handlers: createSecurityHandlers(deps),
  };
}

async function callScanContainer(handlers: ReturnType<typeof createSecurityHandlers>) {
  const res = createMockResponse();
  await handlers.scanContainer({ params: { id: 'c1' } } as any, res as any);
  return res;
}

function callGetContainerVulnerabilities(
  handlers: ReturnType<typeof createSecurityHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  handlers.getContainerVulnerabilities({ params: { id } } as any, res as any);
  return res;
}

async function callGetContainerSbom(
  handlers: ReturnType<typeof createSecurityHandlers>,
  options: {
    id?: string | string[];
    format?: string;
  } = {},
) {
  const res = createMockResponse();
  await handlers.getContainerSbom(
    {
      params: { id: options.id ?? 'c1' },
      query: options.format ? { format: options.format } : {},
    } as any,
    res as any,
  );
  return res;
}

describe('api/container/security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getContainerVulnerabilities', () => {
    test('returns 404 when the container does not exist', () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = callGetContainerVulnerabilities(harness.handlers);

      expect(harness.storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('returns an empty vulnerability payload when no scan exists', () => {
      const harness = createHarness({
        container: createContainer({ security: {} }),
      });

      const res = callGetContainerVulnerabilities(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        scanner: undefined,
        scannedAt: undefined,
        status: 'not-scanned',
        blockSeverities: [],
        blockingCount: 0,
        summary: {
          unknown: 0,
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
        vulnerabilities: [],
      });
    });

    test('returns stored scan payload when available', () => {
      const scan = createScanResult({
        status: 'blocked',
        blockingCount: 2,
        vulnerabilities: [{ id: 'CVE-123', severity: 'HIGH' }],
      });
      const harness = createHarness({
        container: createContainer({ security: { scan } }),
      });

      const res = callGetContainerVulnerabilities(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(scan);
    });
  });

  describe('getContainerSbom', () => {
    test('returns 400 for an unsupported sbom format', async () => {
      const harness = createHarness();

      const res = await callGetContainerSbom(harness.handlers, { format: 'foo-json' });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unsupported SBOM format. Supported values: spdx-json, cyclonedx-json',
      });
      expect(harness.deps.generateImageSbom).not.toHaveBeenCalled();
    });

    test('returns 404 when the container does not exist', async () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = await callGetContainerSbom(harness.handlers);

      expect(harness.storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(harness.deps.generateImageSbom).not.toHaveBeenCalled();
    });

    test('returns cached generated sbom document when requested format exists', async () => {
      const cachedSbom = createSbomResult(CURRENT_IMAGE, {
        status: 'generated',
        formats: ['spdx-json', 'cyclonedx-json'],
        documents: {
          'spdx-json': { SPDXID: 'SPDXRef-CACHED' },
          'cyclonedx-json': { bomFormat: 'CycloneDX' },
        },
      });
      const harness = createHarness({
        container: createContainer({ security: { sbom: cachedSbom } }),
      });

      const res = await callGetContainerSbom(harness.handlers, { format: 'spdx-json' });

      expect(harness.deps.generateImageSbom).not.toHaveBeenCalled();
      expect(harness.storeContainer.updateContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        generator: cachedSbom.generator,
        image: cachedSbom.image,
        generatedAt: cachedSbom.generatedAt,
        format: 'spdx-json',
        document: { SPDXID: 'SPDXRef-CACHED' },
        error: cachedSbom.error,
      });
    });

    test('generates sbom and persists merged documents when requested format is missing', async () => {
      const existingSbom = createSbomResult(CURRENT_IMAGE, {
        status: 'generated',
        formats: ['spdx-json'],
        documents: {
          'spdx-json': { SPDXID: 'SPDXRef-CACHED' },
        },
      });
      const generatedSbom = createSbomResult(CURRENT_IMAGE, {
        status: 'generated',
        formats: ['cyclonedx-json'],
        documents: {
          'cyclonedx-json': { bomFormat: 'CycloneDX', specVersion: '1.6' },
        },
      });
      const harness = createHarness({
        container: createContainer({ security: { sbom: existingSbom } }),
      });
      harness.deps.generateImageSbom.mockResolvedValueOnce(generatedSbom);

      const res = await callGetContainerSbom(harness.handlers, { format: 'cyclonedx-json' });

      expect(harness.deps.getContainerImageFullName).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
      expect(harness.deps.getContainerRegistryAuth).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
      expect(harness.deps.generateImageSbom).toHaveBeenCalledWith({
        image: CURRENT_IMAGE,
        auth: AUTH,
        formats: ['cyclonedx-json'],
      });
      expect(harness.storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            sbom: expect.objectContaining({
              documents: {
                'spdx-json': { SPDXID: 'SPDXRef-CACHED' },
                'cyclonedx-json': { bomFormat: 'CycloneDX', specVersion: '1.6' },
              },
            }),
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        generator: generatedSbom.generator,
        image: generatedSbom.image,
        generatedAt: generatedSbom.generatedAt,
        format: 'cyclonedx-json',
        document: { bomFormat: 'CycloneDX', specVersion: '1.6' },
        error: generatedSbom.error,
      });
    });

    test('returns 500 when sbom generation succeeds without requested document', async () => {
      const harness = createHarness();
      harness.deps.generateImageSbom.mockResolvedValueOnce(
        createSbomResult(CURRENT_IMAGE, {
          status: 'generated',
          documents: {},
        }),
      );

      const res = await callGetContainerSbom(harness.handlers, { format: 'spdx-json' });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error generating SBOM',
      });
    });

    test('returns 500 when sbom generation throws', async () => {
      const harness = createHarness();
      harness.deps.generateImageSbom.mockRejectedValueOnce(new Error('generator crashed'));

      const res = await callGetContainerSbom(harness.handlers);

      expect(harness.deps.getErrorMessage).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error generating SBOM',
      });
    });
  });

  describe('scanContainer edge paths', () => {
    test('returns 404 when container does not exist', async () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = await callScanContainer(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(harness.deps.broadcastScanStarted).not.toHaveBeenCalled();
      expect(harness.deps.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('returns 400 when security scanning is disabled', async () => {
      const harness = createHarness({
        securityConfiguration: {
          enabled: false,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: [] },
        },
      });

      const res = await callScanContainer(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Security scanner is not configured' });
      expect(harness.deps.broadcastScanStarted).not.toHaveBeenCalled();
      expect(harness.deps.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('returns 429 when another on-demand scan is already running', async () => {
      const harness = createHarness({
        container: createContainer({
          updateAvailable: false,
          result: undefined,
        }),
      });
      const firstScanResult = createScanResult();
      const thirdScanResult = createScanResult({
        scannedAt: '2026-03-04T12:05:00.000Z',
      });
      let releaseFirstScan: (() => void) | undefined;

      harness.deps.scanImageForVulnerabilities
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirstScan = () => resolve(firstScanResult);
            }),
        )
        .mockResolvedValueOnce(thirdScanResult);

      const firstResponsePromise = callScanContainer(harness.handlers);
      const secondResponse = await callScanContainer(harness.handlers);

      expect(secondResponse.status).toHaveBeenCalledWith(429);
      expect(secondResponse.json).toHaveBeenCalledWith({
        error: 'Too many concurrent security scans in progress',
      });
      expect(harness.deps.broadcastScanStarted).toHaveBeenCalledTimes(1);
      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);

      releaseFirstScan?.();
      const firstResponse = await firstResponsePromise;
      expect(firstResponse.status).toHaveBeenCalledWith(200);

      const thirdResponse = await callScanContainer(harness.handlers);
      expect(thirdResponse.status).toHaveBeenCalledWith(200);
      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(2);
    });

    test('runs only current-image scan and clears stale update fields when no update is available', async () => {
      const staleUpdateScan = createScanResult({ image: UPDATE_IMAGE });
      const staleUpdateSignature = createSignatureResult(UPDATE_IMAGE);
      const staleUpdateSbom = createSbomResult(UPDATE_IMAGE);
      const harness = createHarness({
        container: createContainer({
          updateAvailable: false,
          result: undefined,
          security: {
            updateScan: staleUpdateScan,
            updateSignature: staleUpdateSignature,
            updateSbom: staleUpdateSbom,
          },
        }),
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: true },
          sbom: { enabled: true, formats: ['spdx-json'] },
        },
      });
      const currentScan = createScanResult({ image: CURRENT_IMAGE });
      const currentSignature = createSignatureResult(CURRENT_IMAGE);
      const currentSbom = createSbomResult(CURRENT_IMAGE);
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(currentScan);
      harness.deps.verifyImageSignature.mockResolvedValueOnce(currentSignature);
      harness.deps.generateImageSbom.mockResolvedValueOnce(currentSbom);

      const res = await callScanContainer(harness.handlers);

      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
      expect(harness.deps.scanImageForVulnerabilities).toHaveBeenCalledWith({
        image: CURRENT_IMAGE,
        auth: AUTH,
      });
      expect(harness.deps.verifyImageSignature).toHaveBeenCalledTimes(1);
      expect(harness.deps.generateImageSbom).toHaveBeenCalledTimes(1);
      expect(harness.storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: currentScan,
            signature: currentSignature,
            sbom: currentSbom,
            updateScan: undefined,
            updateSignature: undefined,
            updateSbom: undefined,
          }),
        }),
      );
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('returns 500 and marks completion as error when current-image scan fails', async () => {
      const harness = createHarness();
      harness.deps.scanImageForVulnerabilities.mockRejectedValueOnce(new Error('scan failed'));

      const res = await callScanContainer(harness.handlers);

      expect(harness.deps.broadcastScanStarted).toHaveBeenCalledWith('c1');
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
      expect(harness.storeContainer.updateContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Security scan failed',
      });
    });

    test('emits a security alert when current-image scan reports high or critical findings', async () => {
      const harness = createHarness({
        container: createContainer({
          updateAvailable: false,
          result: undefined,
        }),
      });
      const summary = { unknown: 1, low: 2, medium: 3, high: 4, critical: 5 };
      const scanResult = createScanResult({
        status: 'blocked',
        blockingCount: 9,
        summary,
      });
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(scanResult);

      const res = await callScanContainer(harness.handlers);

      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledTimes(1);
      expect(harness.deps.emitSecurityAlert).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        details: 'critical=5, high=4, medium=3, low=2, unknown=1',
        status: 'blocked',
        summary,
        blockingCount: 9,
        container: expect.objectContaining({
          id: 'c1',
          name: 'nginx',
        }),
      });
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'blocked');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('scanContainer update-image path', () => {
    test('runs signature verification for both current and update images when configured', async () => {
      const harness = createHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: true },
          sbom: { enabled: false, formats: [] },
        },
      });
      const currentScan = createScanResult({ image: CURRENT_IMAGE });
      const updateScan = createScanResult({
        image: UPDATE_IMAGE,
        summary: { unknown: 0, low: 1, medium: 0, high: 0, critical: 0 },
      });
      const currentSignature = createSignatureResult(CURRENT_IMAGE);
      const updateSignature = createSignatureResult(UPDATE_IMAGE);
      harness.deps.scanImageForVulnerabilities
        .mockResolvedValueOnce(currentScan)
        .mockResolvedValueOnce(updateScan);
      harness.deps.verifyImageSignature
        .mockResolvedValueOnce(currentSignature)
        .mockResolvedValueOnce(updateSignature);

      const res = await callScanContainer(harness.handlers);

      expect(harness.deps.verifyImageSignature).toHaveBeenNthCalledWith(1, {
        image: CURRENT_IMAGE,
        auth: AUTH,
      });
      expect(harness.deps.verifyImageSignature).toHaveBeenNthCalledWith(2, {
        image: UPDATE_IMAGE,
        auth: AUTH,
      });
      expect(harness.storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: currentScan,
            signature: currentSignature,
            updateScan: updateScan,
            updateSignature,
          }),
        }),
      );
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('generates SBOM for both current and update images when configured', async () => {
      const harness = createHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: true, formats: ['spdx-json'] },
        },
      });
      const currentScan = createScanResult({ image: CURRENT_IMAGE });
      const updateScan = createScanResult({
        image: UPDATE_IMAGE,
        summary: { unknown: 0, low: 1, medium: 0, high: 0, critical: 0 },
      });
      const currentSbom = createSbomResult(CURRENT_IMAGE);
      const updateSbom = createSbomResult(UPDATE_IMAGE);
      harness.deps.scanImageForVulnerabilities
        .mockResolvedValueOnce(currentScan)
        .mockResolvedValueOnce(updateScan);
      harness.deps.generateImageSbom
        .mockResolvedValueOnce(currentSbom)
        .mockResolvedValueOnce(updateSbom);

      const res = await callScanContainer(harness.handlers);

      expect(harness.deps.generateImageSbom).toHaveBeenNthCalledWith(1, {
        image: CURRENT_IMAGE,
        auth: AUTH,
        formats: ['spdx-json'],
      });
      expect(harness.deps.generateImageSbom).toHaveBeenNthCalledWith(2, {
        image: UPDATE_IMAGE,
        auth: AUTH,
        formats: ['spdx-json'],
      });
      expect(harness.storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: currentScan,
            sbom: currentSbom,
            updateScan: updateScan,
            updateSbom,
          }),
        }),
      );
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('preserves current scan response when update-image SBOM generation fails', async () => {
      const harness = createHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: true, formats: ['spdx-json'] },
        },
      });
      const currentScan = createScanResult({ image: CURRENT_IMAGE });
      const updateScan = createScanResult({ image: UPDATE_IMAGE });
      const currentSbom = createSbomResult(CURRENT_IMAGE);
      harness.deps.scanImageForVulnerabilities
        .mockResolvedValueOnce(currentScan)
        .mockResolvedValueOnce(updateScan);
      harness.deps.generateImageSbom
        .mockResolvedValueOnce(currentSbom)
        .mockRejectedValueOnce(new Error('update sbom unavailable'));

      const res = await callScanContainer(harness.handlers);

      expect(harness.storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: currentScan,
            sbom: currentSbom,
            updateScan: updateScan,
          }),
        }),
      );
      const persistedContainer = harness.storeContainer.updateContainer.mock.calls[0][0];
      expect(persistedContainer.security.updateSbom).toBeUndefined();
      expect(harness.deps.log.info).toHaveBeenCalledWith(
        'Update image scan failed (update sbom unavailable), current scan preserved',
      );
      expect(harness.deps.broadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('digest scan cache population', () => {
    test('populates digest scan cache after successful on-demand scan', async () => {
      const harness = createHarness({
        container: createContainer({
          image: {
            registry: { name: 'hub', url: 'my-registry' },
            name: 'test/app',
            tag: { value: '1.2.3' },
            digest: { watch: true, value: 'sha256:abc123' },
          },
        }),
      });
      const scanResult = createScanResult();
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(scanResult);

      await callScanContainer(harness.handlers);

      expect(harness.deps.updateDigestScanCache).toHaveBeenCalledWith(
        'sha256:abc123',
        scanResult,
        '2026-03-04T11:55:00.000Z',
      );
    });

    test('uses empty DB timestamp when trivy DB status is unavailable', async () => {
      const harness = createHarness({
        container: createContainer({
          image: {
            registry: { name: 'hub', url: 'my-registry' },
            name: 'test/app',
            tag: { value: '1.2.3' },
            digest: { watch: true, value: 'sha256:abc123' },
          },
        }),
      });
      const scanResult = createScanResult();
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(scanResult);
      harness.deps.getTrivyDatabaseStatus.mockResolvedValueOnce(undefined);

      await callScanContainer(harness.handlers);

      expect(harness.deps.updateDigestScanCache).toHaveBeenCalledWith(
        'sha256:abc123',
        scanResult,
        '',
      );
    });

    test('does not populate digest scan cache when container has no digest', async () => {
      const harness = createHarness({
        container: createContainer({
          image: {
            registry: { name: 'hub', url: 'my-registry' },
            name: 'test/app',
            tag: { value: '1.2.3' },
          },
        }),
      });
      const scanResult = createScanResult();
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(scanResult);

      await callScanContainer(harness.handlers);

      expect(harness.deps.updateDigestScanCache).not.toHaveBeenCalled();
    });

    test('does not populate digest scan cache when scan result is error', async () => {
      const harness = createHarness({
        container: createContainer({
          image: {
            registry: { name: 'hub', url: 'my-registry' },
            name: 'test/app',
            tag: { value: '1.2.3' },
            digest: { watch: true, value: 'sha256:abc123' },
          },
        }),
      });
      const scanResult = createScanResult({ status: 'error', error: 'scan failed' });
      harness.deps.scanImageForVulnerabilities.mockResolvedValueOnce(scanResult);

      await callScanContainer(harness.handlers);

      expect(harness.deps.updateDigestScanCache).not.toHaveBeenCalled();
    });
  });
});
