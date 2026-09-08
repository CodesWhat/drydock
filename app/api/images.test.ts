import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetState, mockGetServerConfiguration, mockRecordAuditEvent, mockWarn } =
  vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
    mockGetState: vi.fn(),
    mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
    mockRecordAuditEvent: vi.fn(),
    mockWarn: vi.fn(),
  }));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: mockWarn, debug: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../configuration/index.js', () => ({
  getServerConfiguration: mockGetServerConfiguration,
}));

vi.mock('./audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));

import * as imagesRouter from './images.js';

type Handler = (
  req: ReturnType<typeof createMockRequest>,
  res: ReturnType<typeof createMockResponse>,
  next?: (error?: unknown) => void,
) => unknown;

function getRegisteredArgs(method: 'get' | 'post', path: string): Handler[] {
  imagesRouter.init();
  const call = (mockRouter[method].mock.calls as unknown[][]).find((c) => c[0] === path);
  if (!call) {
    throw new Error(`No route registered for ${method} ${path}`);
  }
  return call.slice(1) as Handler[];
}

async function invokeGet(path: string, req: ReturnType<typeof createMockRequest>) {
  const [handler] = getRegisteredArgs('get', path);
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

async function invokePostPrune(req: ReturnType<typeof createMockRequest>) {
  const [confirm, handler] = getRegisteredArgs('post', '/prune');
  const res = createMockResponse();
  let nextCalled = false;
  await confirm(req, res, () => {
    nextCalled = true;
  });
  if (nextCalled) {
    await handler(req, res);
  }
  return res;
}

function makeDockerApi(
  overrides: Partial<Record<'listImages' | 'listContainers' | 'pruneImages', unknown>> = {},
) {
  return {
    listImages: vi.fn().mockResolvedValue([]),
    listContainers: vi.fn().mockResolvedValue([]),
    pruneImages: vi.fn().mockResolvedValue({ ImagesDeleted: [], SpaceReclaimed: 0 }),
    ...overrides,
  };
}

function makeImage(overrides: Record<string, unknown> = {}) {
  return {
    Id: 'sha256:aaa',
    RepoTags: ['app:latest'],
    RepoDigests: ['app@sha256:aaa'],
    Size: 2048,
    SharedSize: 0,
    Created: 1700000000,
    ...overrides,
  };
}

describe('Images Router', () => {
  let localDockerApi: ReturnType<typeof makeDockerApi>;
  let agentDockerApi: ReturnType<typeof makeDockerApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: true } });
    localDockerApi = makeDockerApi();
    agentDockerApi = makeDockerApi();

    mockGetState.mockReturnValue({
      watcher: {
        'docker.local': { type: 'docker', name: 'local', dockerApi: localDockerApi },
        'edge.docker.remote': {
          type: 'docker',
          name: 'remote',
          agent: 'edge',
          dockerApi: agentDockerApi,
        },
        'edge2.docker.remote2': { type: 'docker', name: 'remote2', agent: 'edge2' },
      },
    });
  });

  describe('init', () => {
    test('registers the list, prune-preview and prune routes', () => {
      imagesRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/prune-preview', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/prune',
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('GET /', () => {
    test('returns images from every supported host, sorted by size desc then id', async () => {
      localDockerApi.listImages.mockResolvedValue([makeImage({ Id: 'sha256:small', Size: 100 })]);
      agentDockerApi.listImages.mockResolvedValue([makeImage({ Id: 'sha256:big', Size: 999 })]);

      const res = await invokeGet('/', createMockRequest());

      expect(localDockerApi.listImages).toHaveBeenCalledWith({ all: false, 'shared-size': true });
      expect(agentDockerApi.listImages).toHaveBeenCalledWith({ all: false, 'shared-size': true });

      expect(res.status).toHaveBeenCalledWith(200);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.total).toBe(2);
      expect(body.data.map((item: { id: string }) => item.id)).toStrictEqual([
        'sha256:big',
        'sha256:small',
      ]);
      expect(body.hosts).toStrictEqual([
        { id: 'docker.local', name: 'local', supported: true },
        { id: 'edge.docker.remote', name: 'remote', agent: 'edge', supported: true },
        {
          id: 'edge2.docker.remote2',
          name: 'remote2',
          agent: 'edge2',
          supported: false,
          reason: 'agent-transport-unsupported',
        },
      ]);
      expect(body.hosts.every((host: Record<string, unknown>) => !('dockerApi' in host))).toBe(
        true,
      );
    });

    test('breaks a size tie by id when sorting', async () => {
      localDockerApi.listImages.mockResolvedValue([makeImage({ Id: 'sha256:zzz', Size: 500 })]);
      agentDockerApi.listImages.mockResolvedValue([makeImage({ Id: 'sha256:aaa', Size: 500 })]);

      const res = await invokeGet('/', createMockRequest());

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.data.map((item: { id: string }) => item.id)).toStrictEqual([
        'sha256:aaa',
        'sha256:zzz',
      ]);
    });

    test('scopes to a single host when host is provided, but still lists every host', async () => {
      localDockerApi.listImages.mockResolvedValue([makeImage()]);

      const res = await invokeGet('/', createMockRequest({ query: { host: 'docker.local' } }));

      expect(agentDockerApi.listImages).not.toHaveBeenCalled();
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.total).toBe(1);
      expect(body.hosts).toStrictEqual([
        { id: 'docker.local', name: 'local', supported: true },
        { id: 'edge.docker.remote', name: 'remote', agent: 'edge', supported: true },
        {
          id: 'edge2.docker.remote2',
          name: 'remote2',
          agent: 'edge2',
          supported: false,
          reason: 'agent-transport-unsupported',
        },
      ]);
    });

    test('isolates a per-host failure to that host summary without a 500', async () => {
      localDockerApi.listImages.mockResolvedValue([makeImage()]);
      agentDockerApi.listImages.mockRejectedValue(new Error('agent unreachable'));

      const res = await invokeGet('/', createMockRequest());

      expect(res.status).toHaveBeenCalledWith(200);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.total).toBe(1);
      const failedHostSummary = body.hosts.find(
        (host: { id: string }) => host.id === 'edge.docker.remote',
      );
      expect(failedHostSummary.error).toBe('agent unreachable');
      expect(failedHostSummary).not.toHaveProperty('dockerApi');
      expect(mockWarn).toHaveBeenCalled();
    });

    test('stringifies a non-Error per-host failure', async () => {
      localDockerApi.listImages.mockRejectedValue('listImages exploded');

      const res = await invokeGet('/', createMockRequest());

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const failedHostSummary = body.hosts.find(
        (host: { id: string }) => host.id === 'docker.local',
      );
      expect(failedHostSummary.error).toBe('listImages exploded');
    });

    test('returns 404 for an unknown host', async () => {
      const res = await invokeGet('/', createMockRequest({ query: { host: 'missing' } }));

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Image host not found' });
    });

    test('returns 501 for an unsupported agent host', async () => {
      const res = await invokeGet(
        '/',
        createMockRequest({ query: { host: 'edge2.docker.remote2' } }),
      );

      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('agent connection'),
      });
    });
  });

  describe('GET /prune-preview', () => {
    test('returns 403 when container actions are disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('returns 400 when host is missing', async () => {
      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'host is required' });
    });

    test('returns 400 for an invalid mode', async () => {
      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'everything' } }),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'mode must be "dangling" or "unused"' });
    });

    test('returns 404 for an unknown host', async () => {
      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'missing', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Image host not found' });
    });

    test('returns 501 for an unsupported agent host', async () => {
      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'edge2.docker.remote2', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(501);
    });

    test('returns the reclaimable estimate unwrapped for dangling mode', async () => {
      localDockerApi.listImages.mockResolvedValue([
        makeImage({ Id: 'sha256:dangling', RepoTags: [], Size: 500, SharedSize: -1 }),
      ]);

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        host: 'docker.local',
        mode: 'dangling',
        images: 1,
        reclaimable: 500,
      });
    });

    test('returns the reclaimable estimate unwrapped for unused mode', async () => {
      localDockerApi.listImages.mockResolvedValue([
        makeImage({ Id: 'sha256:tagged', RepoTags: ['app:latest'], Size: 700, SharedSize: -1 }),
      ]);

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'unused' } }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        host: 'docker.local',
        mode: 'unused',
        images: 1,
        reclaimable: 700,
      });
    });

    test('returns the reclaimable estimate for an agent host', async () => {
      agentDockerApi.listImages.mockResolvedValue([
        makeImage({ Id: 'sha256:remote', RepoTags: [], Size: 300, SharedSize: -1 }),
      ]);

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        host: 'edge.docker.remote',
        mode: 'dangling',
        images: 1,
        reclaimable: 300,
      });
    });

    test.each(['listImages', 'listContainers'] as const)(
      'reports an agent %s preview timeout without implying a prune started',
      async (method) => {
        agentDockerApi[method].mockRejectedValue(
          Object.assign(new Error('gateway timeout'), { statusCode: 504 }),
        );

        const res = await invokeGet(
          '/prune-preview',
          createMockRequest({ query: { host: 'edge.docker.remote', mode: 'dangling' } }),
        );

        expect(res.status).toHaveBeenCalledWith(504);
        expect(res.json).toHaveBeenCalledWith({
          error:
            "The agent's Docker proxy returned no preview result. No prune was started. Retry the preview.",
        });
        expect(agentDockerApi.pruneImages).not.toHaveBeenCalled();
        expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      },
    );

    test('maps a local host inventory failure to 500', async () => {
      localDockerApi.listImages.mockRejectedValue(new Error('inventory failed'));

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'inventory failed' });
    });

    test('stringifies a non-Error inventory failure', async () => {
      localDockerApi.listImages.mockRejectedValue('inventory exploded');

      const res = await invokeGet(
        '/prune-preview',
        createMockRequest({ query: { host: 'docker.local', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'inventory exploded' });
    });
  });

  describe('POST /prune', () => {
    function pruneRequest(overrides: Record<string, unknown> = {}) {
      return createMockRequest({
        headers: { 'x-dd-confirm-action': 'image-prune' },
        body: { host: 'docker.local', mode: 'dangling' },
        ...overrides,
      });
    }

    test('returns 428 when the confirmation header is missing', async () => {
      const res = await invokePostPrune(
        createMockRequest({ headers: {}, body: { host: 'docker.local', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(428);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Confirmation required: X-DD-Confirm-Action=image-prune',
      });
    });

    test('returns 403 when container actions are disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const res = await invokePostPrune(pruneRequest());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('returns 400 when the body is missing entirely', async () => {
      const res = await invokePostPrune(pruneRequest({ body: undefined }));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'host is required' });
    });

    test('returns 400 when host is missing from the body', async () => {
      const res = await invokePostPrune(pruneRequest({ body: { mode: 'dangling' } }));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'host is required' });
    });

    test('returns 400 for an invalid mode', async () => {
      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'docker.local', mode: 'everything' } }),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'mode must be "dangling" or "unused"' });
    });

    test('prunes dangling images, records a success audit entry and returns the result envelope', async () => {
      localDockerApi.pruneImages.mockResolvedValue({
        ImagesDeleted: [{ Deleted: 'sha256:one' }, { Untagged: 'app:old' }],
        SpaceReclaimed: 4096,
      });

      const res = await invokePostPrune(pruneRequest());

      expect(localDockerApi.pruneImages).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Image prune completed',
        result: { host: 'docker.local', mode: 'dangling', imagesDeleted: 1, spaceReclaimed: 4096 },
      });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'image-prune',
        status: 'success',
        containerName: 'docker.local',
        details: 'dangling: 1 images, 4096 bytes',
      });
    });

    test('defaults imagesDeleted and spaceReclaimed to zero when the driver omits them', async () => {
      localDockerApi.pruneImages.mockResolvedValue({});

      const res = await invokePostPrune(pruneRequest());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Image prune completed',
        result: { host: 'docker.local', mode: 'dangling', imagesDeleted: 0, spaceReclaimed: 0 },
      });
    });

    test('prunes unused images with the dangling=false filter', async () => {
      await invokePostPrune(pruneRequest({ body: { host: 'docker.local', mode: 'unused' } }));

      expect(localDockerApi.pruneImages).toHaveBeenCalledWith({
        filters: { dangling: ['false'] },
      });
    });

    test('maps a 502 statusCode from an agent host to a 504 no-result error', async () => {
      const error = Object.assign(new Error('bad gateway'), { statusCode: 502 });
      agentDockerApi.pruneImages.mockRejectedValue(error);

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({
        error:
          "The agent's Docker proxy returned no result; the prune may still be running. Refresh the image list.",
      });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'image-prune', status: 'error' }),
      );
    });

    test('maps a 504 statusCode from an agent host to the 504 no-result error', async () => {
      const error = Object.assign(new Error('gateway timeout'), { statusCode: 504 });
      agentDockerApi.pruneImages.mockRejectedValue(error);

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(504);
    });

    test('maps a timeout message from an agent host to the 504 no-result error', async () => {
      agentDockerApi.pruneImages.mockRejectedValue(new Error('socket hang up'));

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({
        error:
          "The agent's Docker proxy returned no result; the prune may still be running. Refresh the image list.",
      });
    });

    test('does not map an unrelated agent host error to 504', async () => {
      agentDockerApi.pruneImages.mockRejectedValue(new Error('permission denied'));

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'permission denied' });
    });

    test('does not map a plain object rejection with no message to 504', async () => {
      agentDockerApi.pruneImages.mockRejectedValue({ code: 'EPIPE' });

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(500);
    });

    test('returns 500 and records an audit failure entry for a local host error', async () => {
      localDockerApi.pruneImages.mockRejectedValue(new Error('disk error'));

      const res = await invokePostPrune(pruneRequest());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'disk error' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'image-prune',
        status: 'error',
        containerName: 'docker.local',
        details: 'disk error',
      });
    });

    test('stringifies a non-Error rejection from an agent host', async () => {
      agentDockerApi.pruneImages.mockRejectedValue('boom string');

      const res = await invokePostPrune(
        pruneRequest({ body: { host: 'edge.docker.remote', mode: 'dangling' } }),
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'boom string' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ details: 'boom string' }),
      );
    });
  });
});
