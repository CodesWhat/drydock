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

describe('api/container/security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
