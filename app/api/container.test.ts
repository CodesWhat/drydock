// @ts-nocheck
import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));
const mockGenerateImageSbom = vi.hoisted(() => vi.fn());
const mockScanImageForVulnerabilities = vi.hoisted(() => vi.fn());
const mockVerifyImageSignature = vi.hoisted(() => vi.fn());
const mockBroadcastScanStarted = vi.hoisted(() => vi.fn());
const mockBroadcastScanCompleted = vi.hoisted(() => vi.fn());
const mockEmitSecurityAlert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetOperationsByContainerName = vi.hoisted(() => vi.fn());

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('express-rate-limit', () => ({ default: vi.fn(() => 'rate-limit-middleware') }));

vi.mock('../store/container', () => ({
  getContainers: vi.fn(() => []),
  getContainer: vi.fn(),
  updateContainer: vi.fn((container) => container),
  deleteContainer: vi.fn(),
}));

vi.mock('../store/update-operation', () => ({
  getOperationsByContainerName: (...args: unknown[]) => mockGetOperationsByContainerName(...args),
}));

vi.mock('../registry', () => ({
  getState: vi.fn(() => ({
    watcher: {},
    trigger: {},
  })),
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: vi.fn(() => ({
    feature: { delete: true },
  })),
  getSecurityConfiguration: vi.fn(() => ({
    enabled: false,
    scanner: undefined,
    signature: { verify: false },
    sbom: { enabled: false, formats: [] },
  })),
}));

vi.mock('./component', () => ({
  mapComponentsToList: vi.fn(() => []),
}));

vi.mock('../security/scan', () => ({
  generateImageSbom: (...args: unknown[]) => mockGenerateImageSbom(...args),
  scanImageForVulnerabilities: (...args: unknown[]) => mockScanImageForVulnerabilities(...args),
  verifyImageSignature: (...args: unknown[]) => mockVerifyImageSignature(...args),
  SECURITY_SBOM_FORMATS: ['spdx-json', 'cyclonedx-json'],
}));

vi.mock('../triggers/providers/Trigger', () => ({
  __esModule: true,
  default: {
    parseIncludeOrIncludeTriggerString: vi.fn((str) => ({ id: str })),
    doesReferenceMatchId: vi.fn(() => false),
  },
}));

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() })) } }));

vi.mock('../agent/manager', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../event/index.js', () => ({
  emitSecurityAlert: (...args: unknown[]) => mockEmitSecurityAlert(...args),
}));

vi.mock('./sse', () => ({
  broadcastScanStarted: (...args: unknown[]) => mockBroadcastScanStarted(...args),
  broadcastScanCompleted: (...args: unknown[]) => mockBroadcastScanCompleted(...args),
}));

import { getAgent } from '../agent/manager.js';
import { getSecurityConfiguration, getServerConfiguration } from '../configuration/index.js';
import rateLimit from 'express-rate-limit';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import Trigger from '../triggers/providers/Trigger.js';
import { mapComponentsToList } from './component.js';
import * as containerRouter from './container.js';

function createResponse() {
  return createMockResponse();
}

function getHandler(method, path) {
  containerRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[call.length - 1];
}

/** Helper: invoke deleteContainer with a given container id and return the response mock */
async function callDeleteContainer(id = 'c1') {
  const res = createResponse();
  await containerRouter.deleteContainer({ params: { id } }, res);
  return res;
}

/** Helper: set up a remote container with a mock agent and call deleteContainer */
async function callDeleteRemoteContainer(agentSetup) {
  storeContainer.getContainer.mockReturnValue({ id: 'c1', agent: 'remote' });
  if (agentSetup) {
    getAgent.mockReturnValue(agentSetup);
  } else {
    getAgent.mockReturnValue(undefined);
  }
  return callDeleteContainer();
}

/** Helper: invoke the runTrigger handler (3-segment route) */
async function callRunTrigger(params) {
  const handler = getHandler('post', '/:id/triggers/:triggerType/:triggerName');
  const res = createResponse();
  await handler({ params }, res);
  return res;
}

/** Helper: invoke patchContainerUpdatePolicy handler */
function callUpdatePolicy(container, body) {
  storeContainer.getContainer.mockReturnValue(container);
  containerRouter.init();
  const route = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id/update-policy');
  const handler = route[1];
  const res = createResponse();
  handler({ params: { id: container?.id ?? 'missing' }, body }, res);
  return res;
}

/** Helper: invoke watchContainer handler */
async function callWatchContainer(id = 'c1') {
  const handler = getHandler('post', '/:id/watch');
  const res = createResponse();
  await handler({ params: { id } }, res);
  return res;
}

/** Helper: set up trigger filter test scenario */
async function callGetContainerTriggers(container, triggers) {
  storeContainer.getContainer.mockReturnValue(container);
  mapComponentsToList.mockReturnValue(triggers);
  const res = createResponse();
  await containerRouter.getContainerTriggers({ params: { id: container.id } }, res);
  return res;
}

/** Extract the triggers array from a response json call */
function getTriggersFromResponse(res) {
  return res.json.mock.calls[0][0];
}

/** Get the updatePolicy from the first updateContainer call */
function getUpdatedPolicy() {
  return storeContainer.updateContainer.mock.calls[0][0].updatePolicy;
}

describe('Container Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateImageSbom.mockResolvedValue({
      generator: 'trivy',
      image: 'registry.example.com/test/app:1.2.3',
      generatedAt: '2026-02-15T12:00:00.000Z',
      status: 'generated',
      formats: ['spdx-json'],
      documents: {
        'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
      },
    });
  });

  describe('init', () => {
    test('should register all routes', () => {
      const router = containerRouter.init();
      expect(router.use).toHaveBeenCalledWith('nocache-middleware');
      expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith('/watch', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(router.delete).toHaveBeenCalledWith('/:id', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:id/triggers', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith(
        '/:id/triggers/:triggerType/:triggerName',
        expect.any(Function),
      );
      expect(router.post).toHaveBeenCalledWith(
        '/:id/triggers/:triggerAgent/:triggerType/:triggerName',
        expect.any(Function),
      );
      expect(router.patch).toHaveBeenCalledWith('/:id/update-policy', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith('/:id/watch', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:id/vulnerabilities', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:id/sbom', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/:id/update-operations', expect.any(Function));
      expect(router.post).toHaveBeenCalledWith(
        '/:id/scan',
        'rate-limit-middleware',
        expect.any(Function),
      );
      expect(router.get).toHaveBeenCalledWith('/:id/logs', expect.any(Function));
    });

    test('should disable xForwardedForHeader validation on scan rate-limiter', () => {
      containerRouter.init();
      const rateLimitOptions = rateLimit.mock.calls[0][0];
      expect(rateLimitOptions.validate).toEqual({ xForwardedForHeader: false });
    });
  });

  describe('getContainers', () => {
    test('should return containers from store', () => {
      storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);
      const handler = getHandler('get', '/');
      const res = createResponse();
      handler({ query: {} }, res);

      expect(storeContainer.getContainers).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([{ id: 'c1' }]);
    });

    test('should redact container runtime environment variable values', () => {
      const container = {
        id: 'c1',
        details: {
          ports: ['8080:8080'],
          volumes: ['/tmp:/tmp'],
          env: [
            { key: 'DB_PASSWORD', value: 'super-secret-password' },
            { key: 'API_TOKEN', value: 'abcdef' },
          ],
        },
      };
      storeContainer.getContainers.mockReturnValue([container]);

      const handler = getHandler('get', '/');
      const res = createResponse();
      handler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        {
          id: 'c1',
          details: {
            ports: ['8080:8080'],
            volumes: ['/tmp:/tmp'],
            env: [
              { key: 'DB_PASSWORD', value: '[REDACTED]' },
              { key: 'API_TOKEN', value: '[REDACTED]' },
            ],
          },
        },
      ]);
      expect(container.details.env[0].value).toBe('super-secret-password');
    });
  });

  describe('getContainersFromStore', () => {
    test('should delegate to store getContainers', () => {
      storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);
      const result = containerRouter.getContainersFromStore({ watcher: 'docker' });
      expect(storeContainer.getContainers).toHaveBeenCalledWith({ watcher: 'docker' });
      expect(result).toEqual([{ id: 'c1' }]);
    });
  });

  describe('getContainer', () => {
    test('should return container when found', () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'test' });
      const handler = getHandler('get', '/:id');
      const res = createResponse();
      handler({ params: { id: 'c1' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 'c1', name: 'test' });
    });

    test('should redact runtime environment variable values when container is found', () => {
      const container = {
        id: 'c1',
        name: 'test',
        details: {
          ports: ['8080:8080'],
          volumes: ['/tmp:/tmp'],
          env: [{ key: 'AWS_SECRET_ACCESS_KEY', value: 'top-secret' }],
        },
      };
      storeContainer.getContainer.mockReturnValue(container);
      const handler = getHandler('get', '/:id');
      const res = createResponse();
      handler({ params: { id: 'c1' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        id: 'c1',
        name: 'test',
        details: {
          ports: ['8080:8080'],
          volumes: ['/tmp:/tmp'],
          env: [{ key: 'AWS_SECRET_ACCESS_KEY', value: '[REDACTED]' }],
        },
      });
      expect(container.details.env[0].value).toBe('top-secret');
    });

    test('should return 404 when container not found', () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const handler = getHandler('get', '/:id');
      const res = createResponse();
      handler({ params: { id: 'missing' } }, res);

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });
  });

  describe('getContainerUpdateOperations', () => {
    test('should return 404 when container not found', () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const handler = getHandler('get', '/:id/update-operations');
      const res = createResponse();
      handler({ params: { id: 'missing' } }, res);

      expect(res.sendStatus).toHaveBeenCalledWith(404);
      expect(mockGetOperationsByContainerName).not.toHaveBeenCalled();
    });

    test('should return operations for container name', () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      const operations = [
        {
          id: 'op-1',
          status: 'rolled-back',
          phase: 'rolled-back',
          rollbackReason: 'health_gate_failed',
          updatedAt: '2026-02-28T10:00:00.000Z',
        },
        {
          id: 'op-2',
          status: 'succeeded',
          phase: 'succeeded',
          updatedAt: '2026-02-28T09:00:00.000Z',
        },
      ];
      mockGetOperationsByContainerName.mockReturnValue(operations);

      const handler = getHandler('get', '/:id/update-operations');
      const res = createResponse();
      handler({ params: { id: 'c1' } }, res);

      expect(mockGetOperationsByContainerName).toHaveBeenCalledWith('nginx');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(operations);
    });
  });

  describe('getContainerVulnerabilities', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const handler = getHandler('get', '/:id/vulnerabilities');
      const res = createResponse();
      handler({ params: { id: 'missing' } }, res);
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return empty payload when container has no scan result', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      const handler = getHandler('get', '/:id/vulnerabilities');
      const res = createResponse();
      handler({ params: { id: 'c1' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'not-scanned',
          vulnerabilities: [],
          blockingCount: 0,
        }),
      );
    });

    test('should return scan payload when available', async () => {
      const scan = {
        scanner: 'trivy',
        status: 'blocked',
        blockingCount: 2,
        vulnerabilities: [{ id: 'CVE-123', severity: 'HIGH' }],
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        security: { scan },
      });
      const handler = getHandler('get', '/:id/vulnerabilities');
      const res = createResponse();
      handler({ params: { id: 'c1' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(scan);
    });
  });

  describe('getContainerSbom', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'missing' }, query: {} }, res);
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 400 for unsupported sbom format', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: { format: 'foo' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Unsupported SBOM format'),
        }),
      );
    });

    test('should return existing sbom document when available in container security state', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        security: {
          sbom: {
            generator: 'trivy',
            image: 'registry.example.com/test/app:1.2.3',
            generatedAt: '2026-02-15T12:00:00.000Z',
            status: 'generated',
            formats: ['spdx-json'],
            documents: {
              'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
            },
          },
        },
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(mockGenerateImageSbom).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'spdx-json',
          document: { SPDXID: 'SPDXRef-DOCUMENT' },
        }),
      );
    });

    test('should generate sbom when existing sbom is generated but lacks requested format', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {
          sbom: {
            generator: 'trivy',
            image: 'my-registry/test/app:1.2.3',
            generatedAt: '2026-02-15T12:00:00.000Z',
            status: 'generated',
            formats: ['spdx-json'],
            documents: {
              'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
            },
          },
        },
      });
      mockGenerateImageSbom.mockResolvedValue({
        generator: 'trivy',
        image: 'my-registry/test/app:1.2.3',
        generatedAt: '2026-02-15T12:00:00.000Z',
        status: 'generated',
        formats: ['cyclonedx-json'],
        documents: {
          'cyclonedx-json': { bomFormat: 'CycloneDX' },
        },
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: { format: 'cyclonedx-json' } }, res);
      expect(mockGenerateImageSbom).toHaveBeenCalledWith(
        expect.objectContaining({ formats: ['cyclonedx-json'] }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'cyclonedx-json',
          document: { bomFormat: 'CycloneDX' },
        }),
      );
    });

    test('should generate and persist sbom when not cached', async () => {
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getImageFullName: vi.fn(() => 'my-registry/test/app:1.2.3'),
            getAuthPull: vi.fn(async () => ({ username: 'user', password: 'token' })),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: { format: 'spdx-json' } }, res);
      expect(mockGenerateImageSbom).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'my-registry/test/app:1.2.3',
          auth: { username: 'user', password: 'token' },
          formats: ['spdx-json'],
        }),
      );
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            sbom: expect.objectContaining({
              status: 'generated',
            }),
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 when generated sbom is invalid', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      mockGenerateImageSbom.mockResolvedValue({
        generator: 'trivy',
        image: 'my-registry/test/app:1.2.3',
        generatedAt: '2026-02-15T12:00:00.000Z',
        status: 'error',
        formats: ['spdx-json'],
        documents: {},
        error: 'scanner unavailable',
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('scanner unavailable'),
        }),
      );
    });

    test('should fallback to composed image name when registry helper is missing', async () => {
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {},
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'fallback-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(mockGenerateImageSbom).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'fallback-registry/test/app:1.2.3',
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should continue sbom generation when registry auth lookup throws', async () => {
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getAuthPull: vi.fn(async () => {
              throw new Error('auth lookup failed');
            }),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'fallback-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(mockGenerateImageSbom).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: undefined,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 when sbom result is generated but document is missing for requested format', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      mockGenerateImageSbom.mockResolvedValue({
        generator: 'trivy',
        image: 'my-registry/test/app:1.2.3',
        generatedAt: '2026-02-15T12:00:00.000Z',
        status: 'generated',
        formats: ['spdx-json'],
        documents: {},
      });
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Error generating SBOM'),
        }),
      );
    });

    test('should return 500 when sbom generation throws', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      mockGenerateImageSbom.mockRejectedValue(new Error('generator crashed'));
      const handler = getHandler('get', '/:id/sbom');
      const res = createResponse();
      await handler({ params: { id: 'c1' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('generator crashed'),
        }),
      );
    });
  });

  describe('scanContainer', () => {
    /** Helper: invoke scanContainer handler */
    async function callScanContainer(id = 'c1') {
      const handler = getHandler('post', '/:id/scan');
      const res = createResponse();
      await handler({ params: { id } }, res);
      return res;
    }

    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callScanContainer('missing');
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 400 when security scanner not configured', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      getSecurityConfiguration.mockReturnValue({
        enabled: false,
        scanner: undefined,
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });
      const res = await callScanContainer();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Security scanner is not configured' }),
      );
    });

    test('should return 400 when scanner is not trivy', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'other',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });
      const res = await callScanContainer();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Security scanner is not configured' }),
      );
    });

    test('should scan update candidate image when updateKind is present', async () => {
      const scanResult = {
        status: 'scanned',
        vulnerabilities: [],
        blockingCount: 0,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getImageFullName: vi.fn((image, tag) => `my-registry/${image.name}:${tag}`),
            getAuthPull: vi.fn(async () => ({ username: 'user', password: 'token' })),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        updateKind: { kind: 'tag', remoteValue: '2.0.0' },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c1');
      expect(mockScanImageForVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'my-registry/test/app:2.0.0',
          auth: { username: 'user', password: 'token' },
        }),
      );
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({ scan: scanResult }),
        }),
      );
      expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'scanned');
      expect(mockEmitSecurityAlert).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should redact runtime environment variable values in scan response', async () => {
      const scanResult = {
        status: 'scanned',
        vulnerabilities: [],
        blockingCount: 0,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getImageFullName: vi.fn((image, tag) => `my-registry/${image.name}:${tag}`),
            getAuthPull: vi.fn(async () => ({ username: 'user', password: 'token' })),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        details: {
          ports: [],
          volumes: [],
          env: [{ key: 'DD_API_KEY', value: 'keep-secret' }],
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            ports: [],
            volumes: [],
            env: [{ key: 'DD_API_KEY', value: '[REDACTED]' }],
          },
        }),
      );
    });

    test('should emit security-alert event when scan finds high/critical vulnerabilities', async () => {
      const scanResult = {
        status: 'blocked',
        vulnerabilities: [],
        blockingCount: 2,
        summary: { unknown: 0, low: 0, medium: 3, high: 1, critical: 1 },
      };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getImageFullName: vi.fn((image, tag) => `my-registry/${image.name}:${tag}`),
            getAuthPull: vi.fn(async () => ({ username: 'user', password: 'token' })),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        watcher: 'local',
        name: 'nginx',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        updateKind: { kind: 'tag', remoteValue: '2.0.0' },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockEmitSecurityAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          containerName: 'local_nginx',
          status: 'blocked',
          blockingCount: 2,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should fall back to current tag when no update candidate', async () => {
      const scanResult = { status: 'scanned', vulnerabilities: [] };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          hub: {
            getImageFullName: vi.fn((image, tag) => `my-registry/${image.name}:${tag}`),
            getAuthPull: vi.fn(async () => ({ username: 'user', password: 'token' })),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockScanImageForVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({ image: 'my-registry/test/app:1.2.3' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should run signature verification when configured', async () => {
      const scanResult = { status: 'scanned', vulnerabilities: [] };
      const signatureResult = { status: 'verified' };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      mockVerifyImageSignature.mockResolvedValue(signatureResult);
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: true },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockVerifyImageSignature).toHaveBeenCalled();
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: scanResult,
            signature: signatureResult,
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should generate SBOM when configured', async () => {
      const scanResult = { status: 'scanned', vulnerabilities: [] };
      const sbomResult = { status: 'generated', documents: {} };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      mockGenerateImageSbom.mockResolvedValue(sbomResult);
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: true, formats: ['spdx-json'] },
      });

      const res = await callScanContainer();

      expect(mockGenerateImageSbom).toHaveBeenCalledWith(
        expect.objectContaining({
          formats: ['spdx-json'],
        }),
      );
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({
            scan: scanResult,
            sbom: sbomResult,
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should scan container without pre-existing security property', async () => {
      const scanResult = { status: 'scanned', vulnerabilities: [] };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          security: expect.objectContaining({ scan: scanResult }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should scan with undefined auth when registry has no matching entry', async () => {
      const scanResult = { status: 'scanned', vulnerabilities: [] };
      mockScanImageForVulnerabilities.mockResolvedValue(scanResult);
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: {},
        registry: {
          'other-registry': {
            getImageFullName: vi.fn(),
            getAuthPull: vi.fn(),
          },
        },
      });
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockScanImageForVulnerabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'my-registry/test/app:1.2.3',
          auth: undefined,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 on scan failure', async () => {
      mockScanImageForVulnerabilities.mockRejectedValue(new Error('scan engine crashed'));
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/app',
          tag: { value: '1.2.3' },
        },
        security: {},
      });
      getSecurityConfiguration.mockReturnValue({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: [] },
      });

      const res = await callScanContainer();

      expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c1');
      expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('scan engine crashed'),
        }),
      );
    });
  });

  describe('deleteContainer', () => {
    test('should return 403 when delete feature is disabled', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: false } });
      const res = await callDeleteContainer();
      expect(res.sendStatus).toHaveBeenCalledWith(403);
    });

    test('should return 404 when container not found', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callDeleteContainer();
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should delete local container and return 204', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      const res = await callDeleteContainer();
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    test('should return 500 when agent not found for remote container', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      const res = await callDeleteRemoteContainer(undefined);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Agent remote not found'),
        }),
      );
    });

    test('should delete remote container successfully', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      const mockAgentObj = { deleteContainer: vi.fn().mockResolvedValue(undefined) };
      const res = await callDeleteRemoteContainer(mockAgentObj);
      expect(mockAgentObj.deleteContainer).toHaveBeenCalledWith('c1');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    test('should handle 404 from agent delete and still clean up', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      const error = new Error('Not found');
      error.response = { status: 404 };
      const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
      const res = await callDeleteRemoteContainer(mockAgentObj);
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    test('should return 500 on agent delete error (non-404)', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      const error = new Error('Server error');
      error.response = { status: 500 };
      const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
      const res = await callDeleteRemoteContainer(mockAgentObj);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Error deleting container on agent'),
        }),
      );
    });

    test('should handle agent delete error without response', async () => {
      getServerConfiguration.mockReturnValue({ feature: { delete: true } });
      const error = new Error('Network error');
      const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
      const res = await callDeleteRemoteContainer(mockAgentObj);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('watchContainers', () => {
    test('should watch all watchers and return containers', async () => {
      const mockWatcher = { watch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
        trigger: {},
      });
      storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);

      const handler = getHandler('post', '/watch');
      const res = createResponse();
      await handler({ query: {} }, res);

      expect(mockWatcher.watch).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 when watcher fails', async () => {
      const mockWatcher = { watch: vi.fn().mockRejectedValue(new Error('watch failed')) };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const res = createResponse();
      await handler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('watch failed'),
        }),
      );
    });
  });

  describe('getContainerTriggers', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = createResponse();
      await containerRouter.getContainerTriggers({ params: { id: 'missing' } }, res);
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return associated triggers for container', async () => {
      const res = await callGetContainerTriggers({ id: 'c1' }, [
        { type: 'slack', name: 'default', configuration: {} },
      ]);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.any(Array));
    });

    test('should filter triggers with triggerInclude', async () => {
      Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({ id: 'slack.default' });
      Trigger.doesReferenceMatchId.mockImplementation((ref, id) => ref === id);
      const res = await callGetContainerTriggers({ id: 'c1', triggerInclude: 'slack.default' }, [
        { type: 'slack', name: 'default', configuration: {} },
        { type: 'email', name: 'default', configuration: {} },
      ]);

      expect(res.status).toHaveBeenCalledWith(200);
      const triggers = getTriggersFromResponse(res);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe('slack');
    });

    test('should filter triggers with triggerExclude', async () => {
      Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({ id: 'slack.default' });
      Trigger.doesReferenceMatchId.mockImplementation((ref, id) => ref === id);
      const res = await callGetContainerTriggers({ id: 'c1', triggerExclude: 'slack.default' }, [
        { type: 'slack', name: 'default', configuration: {} },
        { type: 'email', name: 'default', configuration: {} },
      ]);

      expect(res.status).toHaveBeenCalledWith(200);
      const triggers = getTriggersFromResponse(res);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe('email');
    });

    test('should exclude remote triggers for different agent', async () => {
      const res = await callGetContainerTriggers({ id: 'c1', agent: 'agent-1' }, [
        { type: 'slack', name: 'default', configuration: {}, agent: 'agent-2' },
      ]);
      expect(getTriggersFromResponse(res)).toHaveLength(0);
    });

    test('should exclude local docker triggers for remote containers', async () => {
      const res = await callGetContainerTriggers({ id: 'c1', agent: 'agent-1' }, [
        { type: 'docker', name: 'default', configuration: {} },
        { type: 'dockercompose', name: 'default', configuration: {} },
      ]);
      expect(getTriggersFromResponse(res)).toHaveLength(0);
    });

    test('should include triggers with matching include threshold', async () => {
      Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({
        id: 'slack.default',
        threshold: 'all',
      });
      Trigger.doesReferenceMatchId.mockReturnValue(true);
      const res = await callGetContainerTriggers(
        { id: 'c1', triggerInclude: 'slack.default(all)' },
        [{ type: 'slack', name: 'default', configuration: {} }],
      );

      const triggers = getTriggersFromResponse(res);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].configuration.threshold).toBe('all');
    });
  });

  describe('runTrigger', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callRunTrigger({
        id: 'missing',
        triggerType: 'slack',
        triggerName: 'default',
      });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Container not found' }),
      );
    });

    test.each([
      'docker',
      'dockercompose',
    ])('should return 400 for local %s trigger on remote container', async (triggerType) => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', agent: 'remote' });
      const res = await callRunTrigger({ id: 'c1', triggerType, triggerName: 'restart' });
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should return 404 when trigger not found', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
      const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Trigger not found' }),
      );
    });

    test('should run trigger successfully', async () => {
      const mockTrigger = { trigger: vi.fn().mockResolvedValue(undefined) };
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      registry.getState.mockReturnValue({ watcher: {}, trigger: { 'slack.default': mockTrigger } });
      const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
      expect(mockTrigger.trigger).toHaveBeenCalledWith({ id: 'c1' });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 when trigger execution fails', async () => {
      const mockTrigger = { trigger: vi.fn().mockRejectedValue(new Error('trigger error')) };
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      registry.getState.mockReturnValue({ watcher: {}, trigger: { 'slack.default': mockTrigger } });
      const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
      expect(res.status).toHaveBeenCalledWith(500);
    });

    test('should use triggerAgent in trigger id when provided', async () => {
      const mockTrigger = { trigger: vi.fn().mockResolvedValue(undefined) };
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });
      registry.getState.mockReturnValue({
        watcher: {},
        trigger: { 'myagent.slack.default': mockTrigger },
      });
      const handler = getHandler('post', '/:id/triggers/:triggerAgent/:triggerType/:triggerName');
      const res = createResponse();
      await handler(
        {
          params: {
            id: 'c1',
            triggerAgent: 'myagent',
            triggerType: 'slack',
            triggerName: 'default',
          },
        },
        res,
      );
      expect(mockTrigger.trigger).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('watchContainer', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callWatchContainer('missing');
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 500 when watcher not found', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No provider found') }),
      );
    });

    test('should use agent prefix for watcher id when container has agent', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local', agent: 'remote' });
      registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('remote.docker.local') }),
      );
    });

    test('should watch container successfully', async () => {
      const mockWatcher = {
        watchContainer: vi.fn().mockResolvedValue({
          container: {
            id: 'c1',
            result: {},
            details: {
              ports: [],
              volumes: [],
              env: [{ key: 'API_TOKEN', value: 'token-value' }],
            },
          },
        }),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        id: 'c1',
        result: {},
        details: {
          ports: [],
          volumes: [],
          env: [{ key: 'API_TOKEN', value: '[REDACTED]' }],
        },
      });
    });

    test('should return 500 when watch fails', async () => {
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue(new Error('watch error')),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('watch error') }),
      );
    });

    test('should check getContainers and return 404 when container not in list', async () => {
      const mockWatcher = {
        getContainers: vi.fn().mockResolvedValue([{ id: 'other' }]),
        watchContainer: vi.fn(),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should proceed when container is found in getContainers list', async () => {
      const mockWatcher = {
        getContainers: vi.fn().mockResolvedValue([{ id: 'c1' }]),
        watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1' } }),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      const res = await callWatchContainer();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getContainerLogs', () => {
    /** Build a Docker multiplexed stream buffer (8-byte header + payload per frame). */
    function dockerStreamBuffer(text, stream = 1) {
      const payload = Buffer.from(text, 'utf-8');
      const header = Buffer.alloc(8);
      header[0] = stream;
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    }

    /** Helper: invoke getContainerLogs handler */
    async function callGetContainerLogs(id = 'c1', query = {}) {
      const handler = getHandler('get', '/:id/logs');
      const res = createResponse();
      await handler({ params: { id }, query }, res);
      return res;
    }

    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callGetContainerLogs('missing');
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return logs for local container', async () => {
      const logText = '2024-01-01T00:00:00Z log line 1\n2024-01-01T00:00:01Z log line 2';
      const mockLogs = dockerStreamBuffer(logText);
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });

      const res = await callGetContainerLogs('c1');

      expect(mockWatcher.dockerApi.getContainer).toHaveBeenCalledWith('my-container');
      expect(mockDockerContainer.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: 100,
        since: 0,
        timestamps: true,
        follow: false,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: logText });
    });

    test('should demux logs when docker API returns a non-Buffer payload', async () => {
      const logText = 'plain logs';
      const mockLogs = new Uint8Array(dockerStreamBuffer(logText));
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });

      const res = await callGetContainerLogs('c1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: logText });
    });

    test('should ignore truncated docker stream frames', async () => {
      const truncatedHeader = Buffer.alloc(8);
      truncatedHeader[0] = 1;
      truncatedHeader.writeUInt32BE(20, 4);
      const truncatedFrame = Buffer.concat([truncatedHeader, Buffer.from('short')]);

      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(truncatedFrame) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });

      const res = await callGetContainerLogs('c1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: '' });
    });

    test('should pass query params to docker logs', async () => {
      const mockLogs = dockerStreamBuffer('log');
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });

      await callGetContainerLogs('c1', { tail: '50', since: '1700000000', timestamps: 'false' });

      expect(mockDockerContainer.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: 50,
        since: 1700000000,
        timestamps: false,
        follow: false,
      });
    });

    test('should proxy through agent for agent containers', async () => {
      const mockAgent = { getContainerLogs: vi.fn().mockResolvedValue({ logs: 'agent logs' }) };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
        agent: 'remote',
      });
      getAgent.mockReturnValue(mockAgent);

      const res = await callGetContainerLogs('c1');

      expect(mockAgent.getContainerLogs).toHaveBeenCalledWith('c1', {
        tail: 100,
        since: 0,
        timestamps: true,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: 'agent logs' });
    });

    test('should return 500 when agent not found for agent container', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
        agent: 'remote',
      });
      getAgent.mockReturnValue(undefined);

      const res = await callGetContainerLogs('c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Agent remote not found'),
        }),
      );
    });

    test('should return 500 when agent call fails', async () => {
      const mockAgent = { getContainerLogs: vi.fn().mockRejectedValue(new Error('agent error')) };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
        agent: 'remote',
      });
      getAgent.mockReturnValue(mockAgent);

      const res = await callGetContainerLogs('c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Error fetching logs from agent'),
        }),
      );
    });

    test('should return 500 when watcher not found', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: {}, trigger: {} });

      const res = await callGetContainerLogs('c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('No watcher found'),
        }),
      );
    });

    test('should return 500 when docker API fails', async () => {
      const mockDockerContainer = { logs: vi.fn().mockRejectedValue(new Error('docker error')) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });

      const res = await callGetContainerLogs('c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Error fetching container logs'),
        }),
      );
    });
  });

  describe('patchContainerUpdatePolicy', () => {
    test('should return 404 when container not found', () => {
      const res = callUpdatePolicy(undefined, { action: 'clear' });
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 400 when no action provided', () => {
      const res = callUpdatePolicy({ id: 'c1' }, {});
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Action is required' }),
      );
    });

    test('should handle missing body', () => {
      const res = callUpdatePolicy({ id: 'c1' }, undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should return 400 for unknown action', () => {
      const res = callUpdatePolicy({ id: 'c1' }, { action: 'unknown-action' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Unknown action') }),
      );
    });

    test('should skip current tag update', () => {
      const res = callUpdatePolicy(
        { id: 'c1', updateKind: { kind: 'tag', remoteValue: '2.0.0' }, result: { tag: '2.0.0' } },
        { action: 'skip-current' },
      );
      expect(getUpdatedPolicy()).toEqual({ skipTags: ['2.0.0'] });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should redact runtime environment variable values in update-policy response', () => {
      const res = callUpdatePolicy(
        {
          id: 'c1',
          updateKind: { kind: 'tag', remoteValue: '2.0.0' },
          result: { tag: '2.0.0' },
          details: {
            ports: ['8080:8080'],
            volumes: ['/tmp:/tmp'],
            env: [{ key: 'DB_PASSWORD', value: 'super-secret' }],
          },
        },
        { action: 'skip-current' },
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            ports: ['8080:8080'],
            volumes: ['/tmp:/tmp'],
            env: [{ key: 'DB_PASSWORD', value: '[REDACTED]' }],
          },
        }),
      );
    });

    test('should skip current digest update', () => {
      callUpdatePolicy(
        {
          id: 'c1',
          updateKind: { kind: 'digest', remoteValue: 'sha256:abc' },
          result: { digest: 'sha256:abc' },
        },
        { action: 'skip-current' },
      );
      expect(getUpdatedPolicy()).toEqual({ skipDigests: ['sha256:abc'] });
    });

    test('should fall back to result.tag when remoteValue is missing', () => {
      callUpdatePolicy(
        { id: 'c1', updateKind: { kind: 'tag' }, result: { tag: '3.0.0' } },
        { action: 'skip-current' },
      );
      expect(getUpdatedPolicy()).toEqual({ skipTags: ['3.0.0'] });
    });

    test('should fall back to result.digest when remoteValue is missing', () => {
      callUpdatePolicy(
        { id: 'c1', updateKind: { kind: 'digest' }, result: { digest: 'sha256:def' } },
        { action: 'skip-current' },
      );
      expect(getUpdatedPolicy()).toEqual({ skipDigests: ['sha256:def'] });
    });

    test('should return 400 when updateKind is unknown', () => {
      const res = callUpdatePolicy(
        { id: 'c1', updateKind: { kind: 'unknown' }, result: { tag: '2.0.0' } },
        { action: 'skip-current' },
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No current update available') }),
      );
    });

    test('should return 400 when no update value available', () => {
      const res = callUpdatePolicy(
        { id: 'c1', updateKind: { kind: 'tag' }, result: {} },
        { action: 'skip-current' },
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No update value available') }),
      );
    });

    test('should clear skip tags and digests', () => {
      const res = callUpdatePolicy(
        { id: 'c1', updatePolicy: { skipTags: ['2.0.0'], skipDigests: ['sha256:abc'] } },
        { action: 'clear-skips' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should remove an individual skipped tag', () => {
      const res = callUpdatePolicy(
        {
          id: 'c1',
          updatePolicy: { skipTags: ['2.0.0', '3.0.0'], skipDigests: ['sha256:abc'] },
        },
        { action: 'remove-skip', kind: 'tag', value: '2.0.0' },
      );
      expect(getUpdatedPolicy()).toEqual({ skipTags: ['3.0.0'], skipDigests: ['sha256:abc'] });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should remove an individual skipped digest and normalize empty policy fields', () => {
      const res = callUpdatePolicy(
        {
          id: 'c1',
          updatePolicy: { skipDigests: ['sha256:abc'] },
        },
        { action: 'remove-skip', kind: 'digest', value: 'sha256:abc' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test.each([
      ['kind is missing', { action: 'remove-skip', value: '2.0.0' }],
      ['kind is invalid', { action: 'remove-skip', kind: 'unknown', value: '2.0.0' }],
      ['value is missing', { action: 'remove-skip', kind: 'tag' }],
      ['value is empty', { action: 'remove-skip', kind: 'digest', value: '' }],
    ])('should return 400 when remove-skip payload is invalid: %s', (_label, body) => {
      const res = callUpdatePolicy({ id: 'c1', updatePolicy: { skipTags: ['2.0.0'] } }, body);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('remove-skip') }),
      );
    });

    test('should snooze with default 7 days', () => {
      const res = callUpdatePolicy({ id: 'c1' }, { action: 'snooze' });
      expect(getUpdatedPolicy().snoozeUntil).toBeDefined();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should snooze with custom days', () => {
      const res = callUpdatePolicy({ id: 'c1' }, { action: 'snooze', days: 30 });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should snooze with custom snoozeUntil date', () => {
      callUpdatePolicy({ id: 'c1' }, { action: 'snooze', snoozeUntil: '2099-01-01T00:00:00.000Z' });
      expect(getUpdatedPolicy().snoozeUntil).toBe('2099-01-01T00:00:00.000Z');
    });

    test.each([
      ['days is 0', { action: 'snooze', days: 0 }],
      ['days > 365', { action: 'snooze', days: 400 }],
      ['invalid snoozeUntil date', { action: 'snooze', snoozeUntil: 'not-a-date' }],
    ])('should return 400 when %s', (_label, body) => {
      const res = callUpdatePolicy({ id: 'c1' }, body);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should remove snoozeUntil on unsnooze', () => {
      const res = callUpdatePolicy(
        { id: 'c1', updatePolicy: { snoozeUntil: '2099-01-01T00:00:00.000Z' } },
        { action: 'unsnooze' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should clear entire update policy', () => {
      const res = callUpdatePolicy(
        {
          id: 'c1',
          updatePolicy: { skipTags: ['2.0.0'], snoozeUntil: '2099-01-01T00:00:00.000Z' },
        },
        { action: 'clear' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should handle existing policy with dedup and valid data on skip-current', () => {
      callUpdatePolicy(
        {
          id: 'c1',
          updateKind: { kind: 'tag', remoteValue: '3.0.0' },
          updatePolicy: {
            skipTags: ['1.0.0', '1.0.0', 123],
            skipDigests: ['sha256:abc', 'sha256:abc'],
            snoozeUntil: '2099-06-15T00:00:00.000Z',
          },
        },
        { action: 'skip-current' },
      );
      const policy = getUpdatedPolicy();
      expect(policy.skipTags).toEqual(['1.0.0', '3.0.0']);
      expect(policy.skipDigests).toEqual(['sha256:abc']);
      expect(policy.snoozeUntil).toBe('2099-06-15T00:00:00.000Z');
    });

    test('should ignore invalid snoozeUntil in existing policy', () => {
      callUpdatePolicy(
        { id: 'c1', updatePolicy: { snoozeUntil: 'not-a-date' } },
        { action: 'unsnooze' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
    });

    test('should normalize empty skip arrays out of update policy', () => {
      callUpdatePolicy(
        {
          id: 'c1',
          updatePolicy: {
            skipTags: [],
            skipDigests: [],
            snoozeUntil: '2099-01-01T00:00:00.000Z',
          },
        },
        { action: 'unsnooze' },
      );
      expect(getUpdatedPolicy()).toBeUndefined();
    });
  });
});
