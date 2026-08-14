import { createMockRequest, createMockResponse } from '../test/helpers.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const {
  mockRouter,
  mockGetContainer,
  mockGetContainers,
  mockUpdateContainer,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
  mockGetContainerActionsCounter,
  mockGetServerConfiguration,
  mockInsertOperation,
  mockMarkOperationTerminal,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockGetContainers: vi.fn(),
  mockUpdateContainer: vi.fn((c) => c),
  mockGetState: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(() => ({ inc: vi.fn() })),
  mockGetContainerActionsCounter: vi.fn(() => ({ inc: vi.fn() })),
  mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
  mockInsertOperation: vi.fn((op) => ({ id: op.id || 'op-mock', ...op })),
  mockMarkOperationTerminal: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
  updateContainer: mockUpdateContainer,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

vi.mock('../prometheus/container-actions.js', () => ({
  getContainerActionsCounter: mockGetContainerActionsCounter,
}));

vi.mock('../configuration/index.js', () => ({
  getServerConfiguration: mockGetServerConfiguration,
  getVersion: vi.fn(() => 'test-version'),
}));

vi.mock('../store/update-operation.js', () => ({
  listActiveOperations: vi.fn(() => []),
  insertOperation: mockInsertOperation,
  updateOperation: vi.fn(),
  markOperationTerminal: mockMarkOperationTerminal,
  getOperationById: vi.fn(),
  getOperationsByContainerName: vi.fn(() => []),
  getOperationsByContainerId: vi.fn(() => []),
  getInProgressOperationByContainerName: vi.fn(),
  getInProgressOperationByContainerId: vi.fn(),
  getActiveOperationByContainerName: vi.fn(),
  getActiveOperationByContainerId: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import * as dependencyGroupsRouter from './dependency-groups.js';

const CONFIRMATION_HEADER = 'x-dd-confirm-action';
const CONFIRMATION_TOKEN = 'dependency-group-update';

function getRegisteredCall(method: 'post', path: string) {
  dependencyGroupsRouter.init();
  return mockRouter[method].mock.calls.find((c) => c[0] === path);
}

/** The actual route handler — last argument, after any middleware. */
function getHandler(method: 'post', path: string) {
  const call = getRegisteredCall(method, path);
  return call?.[call.length - 1];
}

function confirmedRequest(overrides: Record<string, unknown> = {}) {
  return createMockRequest({
    headers: { [CONFIRMATION_HEADER]: CONFIRMATION_TOKEN },
    ...overrides,
  });
}

async function flushAcceptedUpdateWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDockerTrigger() {
  const mockDockerContainer = {
    restart: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Status: 'running' } }),
  };
  return {
    trigger: {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
      getWatcher: vi.fn(() => ({
        dockerApi: { getContainer: vi.fn(() => mockDockerContainer) },
      })),
    },
    dockerContainer: mockDockerContainer,
  };
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    watcher: 'local',
    image: { name: overrides.name },
    updateAvailable: true,
    ...overrides,
  };
}

describe('Dependency Groups Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: true } });
  });

  describe('init', () => {
    test('registers POST /:rootId/update behind the destructive-confirmation gate', () => {
      dependencyGroupsRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/:rootId/update',
        expect.any(Function),
        expect.any(Function),
      );
    });

    test('the confirmation middleware rejects a request missing the confirmation header', () => {
      const call = getRegisteredCall('post', '/:rootId/update');
      const confirmationMiddleware = call?.[1];
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      confirmationMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(428);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Confirmation required: X-DD-Confirm-Action=dependency-group-update',
      });
    });

    test('the confirmation middleware admits a request carrying the confirmation header', () => {
      const call = getRegisteredCall('post', '/:rootId/update');
      const confirmationMiddleware = call?.[1];
      const req = confirmedRequest();
      const res = createMockResponse();
      const next = vi.fn();

      confirmationMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('POST /:rootId/update', () => {
    test('returns 403 when container actions are disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });
      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'db' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('returns 404 when the root container does not exist', async () => {
      mockGetContainer.mockReturnValue(undefined);
      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('accepts every container in the dependency chain, annotated with wave and actionKind', async () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
      const unrelated = makeContainer({ id: 'redis', name: 'redis' });
      mockGetContainer.mockReturnValue(db);
      mockGetContainers.mockReturnValue([db, api, unrelated]);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'db' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toBe('Dependency group update requests processed');
      expect(payload.rejected).toEqual([]);
      expect(payload.accepted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            containerId: 'db',
            containerName: 'db',
            wave: 0,
            actionKind: 'update',
          }),
          expect.objectContaining({
            containerId: 'api',
            containerName: 'api',
            wave: 1,
            actionKind: 'update',
          }),
        ]),
      );
      expect(payload.accepted).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ containerId: 'redis' })]),
      );

      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/v1/dependency-groups/{rootId}/update',
        method: 'post',
        statusCode: '200',
        payload,
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('admits a restart-kind dependent even without its own update available', async () => {
      const app = makeContainer({ id: 'app', name: 'app', updateAvailable: true });
      const sidecar = makeContainer({
        id: 'sidecar',
        name: 'sidecar',
        updateAvailable: false,
        dependsOn: ['app'],
        dependsOnAction: 'restart',
      });
      mockGetContainer.mockReturnValue(app);
      mockGetContainers.mockReturnValue([app, sidecar]);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'app' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      const payload = res.json.mock.calls[0][0];
      expect(payload.accepted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ containerId: 'sidecar', actionKind: 'restart', wave: 1 }),
        ]),
      );
    });

    test('keeps restart-only dispatch and annotation when its upstream is rejected during admission', async () => {
      const app = makeContainer({ id: 'app', name: 'app', updateAvailable: false });
      const sidecar = makeContainer({
        id: 'sidecar',
        name: 'sidecar',
        updateAvailable: false,
        dependsOn: ['app'],
        dependsOnAction: 'restart',
      });
      mockGetContainer.mockReturnValue(app);
      mockGetContainers.mockReturnValue([app, sidecar]);
      const { trigger, dockerContainer } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'app' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      const payload = res.json.mock.calls[0][0];
      expect(payload.rejected).toEqual([
        expect.objectContaining({ containerId: 'app', statusCode: 400 }),
      ]);
      expect(payload.accepted).toEqual([
        expect.objectContaining({ containerId: 'sidecar', actionKind: 'restart', wave: 1 }),
      ]);
      expect(trigger.trigger).not.toHaveBeenCalled();
      expect(dockerContainer.restart).toHaveBeenCalledTimes(1);
    });

    describe('expectedContainerIds blast-radius binding', () => {
      test('proceeds normally when expectedContainerIds is omitted', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
        mockGetContainer.mockReturnValue(db);
        mockGetContainers.mockReturnValue([db, api]);
        const { trigger } = createDockerTrigger();
        mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({ params: { rootId: 'db' } });
        const res = createMockResponse();
        await handler(req, res);
        await flushAcceptedUpdateWork();

        expect(res.status).toHaveBeenCalledWith(200);
      });

      test('proceeds normally when the request body is an object without expectedContainerIds', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        mockGetContainer.mockReturnValue(db);
        mockGetContainers.mockReturnValue([db]);
        const { trigger } = createDockerTrigger();
        mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({ params: { rootId: 'db' }, body: {} });
        const res = createMockResponse();
        await handler(req, res);
        await flushAcceptedUpdateWork();

        expect(res.status).toHaveBeenCalledWith(200);
      });

      test('proceeds when expectedContainerIds matches the current chain, regardless of order', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
        mockGetContainer.mockReturnValue(db);
        mockGetContainers.mockReturnValue([db, api]);
        const { trigger } = createDockerTrigger();
        mockGetState.mockReturnValue({ trigger: { 'docker.local': trigger }, watcher: {} });

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({
          params: { rootId: 'db' },
          body: { expectedContainerIds: ['api', 'db'] },
        });
        const res = createMockResponse();
        await handler(req, res);
        await flushAcceptedUpdateWork();

        expect(res.status).toHaveBeenCalledWith(200);
      });

      test('returns 400 when expectedContainerIds is not an array of strings', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        mockGetContainer.mockReturnValue(db);

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({
          params: { rootId: 'db' },
          body: { expectedContainerIds: 'db' },
        });
        const res = createMockResponse();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'expectedContainerIds must be an array of container ids',
        });
      });

      test('returns 400 when expectedContainerIds contains a non-string entry', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        mockGetContainer.mockReturnValue(db);

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({
          params: { rootId: 'db' },
          body: { expectedContainerIds: ['db', 42] },
        });
        const res = createMockResponse();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
      });

      test('returns 409 with the current chain when the live chain has grown since the preview', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        const api = makeContainer({ id: 'api', name: 'api', dependsOn: ['db'] });
        mockGetContainer.mockReturnValue(db);
        mockGetContainers.mockReturnValue([db, api]);

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({
          params: { rootId: 'db' },
          body: { expectedContainerIds: ['db'] },
        });
        const res = createMockResponse();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Dependency chain has changed since it was last previewed',
          details: { currentContainerIds: ['api', 'db'] },
        });
      });

      test('returns 409 with the current chain when the live chain has shrunk since the preview', async () => {
        const db = makeContainer({ id: 'db', name: 'db' });
        mockGetContainer.mockReturnValue(db);
        mockGetContainers.mockReturnValue([db]);

        const handler = getHandler('post', '/:rootId/update');
        const req = createMockRequest({
          params: { rootId: 'db' },
          body: { expectedContainerIds: ['db', 'api'] },
        });
        const res = createMockResponse();
        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Dependency chain has changed since it was last previewed',
          details: { currentContainerIds: ['db'] },
        });
      });
    });

    test('reports a rejected entry for a chain member with no valid trigger', async () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      const orphan = makeContainer({ id: 'orphan', name: 'orphan', dependsOn: ['db'] });
      mockGetContainer.mockReturnValue(db);
      mockGetContainers.mockReturnValue([db, orphan]);
      mockGetState.mockReturnValue({ trigger: {}, watcher: {} });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'db' } });
      const res = createMockResponse();
      await handler(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.rejected.length).toBeGreaterThan(0);
    });

    test('returns 500 when acceptance throws unexpectedly', async () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      mockGetContainer.mockReturnValue(db);
      mockGetContainers.mockImplementation(() => {
        throw new Error('store blew up');
      });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'db' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unable to accept dependency group update',
      });
    });

    test('returns 500 when acceptance throws a non-Error value', async () => {
      const db = makeContainer({ id: 'db', name: 'db' });
      mockGetContainer.mockReturnValue(db);
      mockGetContainers.mockImplementation(() => {
        throw 'store blew up as string';
      });

      const handler = getHandler('post', '/:rootId/update');
      const req = createMockRequest({ params: { rootId: 'db' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unable to accept dependency group update',
      });
    });
  });
});
