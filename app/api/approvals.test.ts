/**
 * Tests for the pending-approval API (spec-ca-2-approval-queue.md, slices 3 and 4).
 *
 * The store is doubled because its query semantics have their own tests; eligibility is
 * not, so the detail route's hold reasons are the real ones `computeUpdateEligibility`
 * produces for the fixture container. The dispatch module is real and only
 * `requestContainerUpdate` under it is doubled, so an approve's status code and body are
 * produced by the same code the container Update button runs rather than by a stub of it.
 */
import type { ApprovalRecord } from '../model/approval.js';
import type { Container } from '../model/container.js';
import { createMockResponse } from '../test/helpers.js';
import { openApiDocument } from './openapi.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const {
  mockRouter,
  mockListApprovals,
  mockCountApprovals,
  mockGetApprovalById,
  mockDecideApprovalIfPending,
  mockResetApprovalToPending,
  mockUpdateApproval,
  mockGetContainer,
  mockBuildEligibilityContext,
  mockAnnounceApprovalEvent,
  mockRecordAuditEvent,
  mockApplyContainerUpdatePolicyAction,
  mockRequestContainerUpdate,
  mockGetServerConfiguration,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockListApprovals: vi.fn(),
  mockCountApprovals: vi.fn(),
  mockGetApprovalById: vi.fn(),
  mockDecideApprovalIfPending: vi.fn(),
  mockResetApprovalToPending: vi.fn(),
  mockUpdateApproval: vi.fn(),
  mockGetContainer: vi.fn(),
  mockBuildEligibilityContext: vi.fn(),
  mockAnnounceApprovalEvent: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockApplyContainerUpdatePolicyAction: vi.fn(),
  mockRequestContainerUpdate: vi.fn(),
  mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));
vi.mock('../store/approval.js', () => ({
  listApprovals: mockListApprovals,
  countApprovals: mockCountApprovals,
  getApprovalById: mockGetApprovalById,
  decideApprovalIfPending: mockDecideApprovalIfPending,
  resetApprovalToPending: mockResetApprovalToPending,
  updateApproval: mockUpdateApproval,
}));
vi.mock('../approvals/events.js', () => ({
  announceApprovalEvent: mockAnnounceApprovalEvent,
}));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));
vi.mock('./container/update-policy-writer.js', () => ({
  applyContainerUpdatePolicyAction: mockApplyContainerUpdatePolicyAction,
}));
vi.mock('../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../configuration/index.js')>()),
  getServerConfiguration: mockGetServerConfiguration,
}));
vi.mock('../prometheus/container-actions.js', () => ({
  getContainerActionsCounter: vi.fn(() => undefined),
}));
vi.mock('../updates/request-update.js', () => ({
  requestContainerUpdate: mockRequestContainerUpdate,
  UpdateRequestError: class UpdateRequestError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../store/container.js', () => ({ getContainer: mockGetContainer }));
vi.mock('./sse-container-enrichment.js', () => ({
  buildEligibilityContext: mockBuildEligibilityContext,
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import { UpdateRequestError } from '../updates/request-update.js';
import * as approvalsRouter from './approvals.js';

function createRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: 1,
    id: 'approval-1',
    containerId: 'container-1',
    containerIdentityKey: '::local::nginx',
    containerName: 'nginx',
    watcher: 'local',
    image: 'library/nginx',
    fromRef: '1.2.3',
    toRef: '1.2.4',
    candidateRef: '1.2.4',
    updateKind: 'tag',
    semverDiff: 'patch',
    createdAt: '2026-08-29T00:00:00.000Z',
    createdAtMs: Date.parse('2026-08-29T00:00:00.000Z'),
    decision: 'pending',
    ...overrides,
  };
}

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'nginx',
    watcher: 'local',
    image: {
      id: 'image-1',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'library/nginx',
      tag: { value: '1.2.3', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.2.4' },
    updateKind: { kind: 'tag', localValue: '1.2.3', remoteValue: '1.2.4', semverDiff: 'patch' },
    ...overrides,
  } as Container;
}

function getHandler(path: string) {
  approvalsRouter.init();
  return mockRouter.get.mock.calls.find((call) => call[0] === path)?.[1];
}

function getPostHandler(path: string) {
  approvalsRouter.init();
  return mockRouter.post.mock.calls.find((call) => call[0] === path)?.[1];
}

const DECISION_PATHS = ['/:id/approve', '/:id/reject', '/:id/defer'] as const;

async function callDecision(
  path: string,
  options: { id?: unknown; body?: unknown; user?: unknown } = {},
) {
  const res = createMockResponse();
  await getPostHandler(path)(
    { params: { id: options.id ?? 'approval-1' }, body: options.body, user: options.user },
    res,
  );
  return {
    res,
    status: vi.mocked(res.status).mock.calls[0]?.[0],
    body: vi.mocked(res.json).mock.calls[0]?.[0],
  };
}

/** The patch the router reserved the row with, as the store double received it. */
function getReservedPatch() {
  return mockDecideApprovalIfPending.mock.calls[0]?.[1];
}

function getAuditDetails() {
  return JSON.parse(mockRecordAuditEvent.mock.calls[0][0].details);
}

function callList(query: Record<string, unknown>) {
  const res = createMockResponse();
  getHandler('/')({ query }, res);
  return { res, body: vi.mocked(res.json).mock.calls[0][0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListApprovals.mockReturnValue({ records: [createRecord()], total: 1 });
  mockCountApprovals.mockReturnValue({ pending: 2, deferred: 1, decidedToday: 3 });
  mockGetApprovalById.mockReturnValue(undefined);
  mockGetContainer.mockReturnValue(undefined);
  mockDecideApprovalIfPending.mockImplementation((_id: string, patch: Partial<ApprovalRecord>) => ({
    status: 'decided',
    record: { ...createRecord(), ...patch },
  }));
  mockApplyContainerUpdatePolicyAction.mockImplementation((container: Container) => ({
    container,
  }));
  mockRequestContainerUpdate.mockResolvedValue({ operationId: 'op-1' });
  mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: true } });
  mockBuildEligibilityContext.mockReturnValue({
    triggers: {
      'docker.local': {
        type: 'docker',
        configuration: { auto: 'none' },
        getId: () => 'docker.local',
      },
    },
    getActiveOperation: () => undefined,
  });
});

describe('init', () => {
  test('registers the read routes with summary ahead of the id route', () => {
    const router = approvalsRouter.init();

    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    const paths = mockRouter.get.mock.calls.map(([path]) => path);
    expect(paths).toStrictEqual(['/', '/summary', '/:id']);
  });

  test('registers the three decision routes', () => {
    approvalsRouter.init();

    expect(mockRouter.post.mock.calls.map(([path]) => path)).toStrictEqual([...DECISION_PATHS]);
  });
});

describe('GET /', () => {
  test('defaults to the pending queue and returns the standard envelope', () => {
    const { res, body } = callList({});

    expect(mockListApprovals).toHaveBeenCalledWith({ status: 'pending', offset: 0 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body).toStrictEqual({
      data: [createRecord()],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
    });
  });

  test('passes every filter through and paginates', () => {
    mockListApprovals.mockReturnValue({ records: [createRecord()], total: 9 });

    const { body } = callList({
      status: 'all',
      containerId: 'container-1',
      agent: 'edge-1',
      semverDiff: 'major',
      q: 'nginx',
      limit: '1',
      offset: '2',
    });

    expect(mockListApprovals).toHaveBeenCalledWith({
      status: 'all',
      containerId: 'container-1',
      agent: 'edge-1',
      semverDiff: 'major',
      q: 'nginx',
      limit: 1,
      offset: 2,
    });
    expect(body.hasMore).toBe(true);
    expect(body._links).toStrictEqual({
      self: '/api/v1/approvals?status=all&containerId=container-1&agent=edge-1&semverDiff=major&q=nginx&limit=1&offset=2',
      next: '/api/v1/approvals?status=all&containerId=container-1&agent=edge-1&semverDiff=major&q=nginx&limit=1&offset=3',
    });
  });

  test('caps the page size at 200', () => {
    callList({ limit: '5000' });

    expect(mockListApprovals).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
  });

  test('treats an empty filter value as absent', () => {
    callList({ status: '', containerId: '', agent: '', semverDiff: '', q: '' });

    expect(mockListApprovals).toHaveBeenCalledWith({ status: 'pending', offset: 0 });
  });

  test('reads the first value of a repeated query parameter', () => {
    callList({ status: ['deferred', 'all'] });

    expect(mockListApprovals).toHaveBeenCalledWith({ status: 'deferred', offset: 0 });
  });

  test.each([
    ['status', { status: 'archived' }, 'Invalid status query parameter'],
    ['containerId', { containerId: 'a b' }, 'Invalid containerId query parameter'],
    ['agent', { agent: 'edge/1' }, 'Invalid agent query parameter'],
    ['semverDiff', { semverDiff: 'huge' }, 'Invalid semverDiff query parameter'],
    ['q', { q: 'x'.repeat(201) }, 'Invalid q query parameter'],
  ])('rejects an invalid %s with 400', (_label, query, message) => {
    const res = createMockResponse();

    getHandler('/')({ query }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(vi.mocked(res.json).mock.calls[0][0]).toStrictEqual({ error: message });
    expect(mockListApprovals).not.toHaveBeenCalled();
  });
});

describe('GET /summary', () => {
  test('returns the badge counts', () => {
    const res = createMockResponse();

    getHandler('/summary')({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(vi.mocked(res.json).mock.calls[0][0]).toStrictEqual({
      pending: 2,
      deferred: 1,
      decidedToday: 3,
    });
  });
});

describe('GET /:id', () => {
  test('404s for an id no row carries', () => {
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: 'missing' } }, res);

    expect(mockGetApprovalById).toHaveBeenCalledWith('missing');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(vi.mocked(res.json).mock.calls[0][0]).toStrictEqual({ error: 'Approval not found' });
  });

  test('returns the row with live eligibility and its soft blockers as hold reasons', () => {
    mockGetApprovalById.mockReturnValue(createRecord());
    mockGetContainer.mockReturnValue(
      createContainer({ updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' } }),
    );
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: 'approval-1' } }, res);

    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.approval).toStrictEqual(createRecord());
    expect(body.eligibility.eligible).toBe(false);
    expect(body.holdReasons).toStrictEqual([
      expect.objectContaining({ reason: 'snoozed', severity: 'soft' }),
    ]);
  });

  test('keeps a hard blocker in eligibility rather than reporting it as a hold reason', () => {
    mockGetApprovalById.mockReturnValue(createRecord());
    mockGetContainer.mockReturnValue(createContainer());
    mockBuildEligibilityContext.mockReturnValue({
      triggers: {},
      getActiveOperation: () => undefined,
    });
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: 'approval-1' } }, res);

    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(body.holdReasons).toStrictEqual([]);
    expect(body.eligibility.blockers).toStrictEqual([
      expect.objectContaining({ reason: 'no-update-trigger-configured', severity: 'hard' }),
    ]);
  });

  test('reports no eligibility when the container the row points at is gone', () => {
    mockGetApprovalById.mockReturnValue(
      createRecord({ resolution: 'container-removed', resolvedAt: '2026-08-29T01:00:00.000Z' }),
    );
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: 'approval-1' } }, res);

    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.eligibility).toBeUndefined();
    expect(body.holdReasons).toStrictEqual([]);
    expect(mockBuildEligibilityContext).not.toHaveBeenCalled();
  });

  test('reads the first value of a repeated path parameter', () => {
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: ['approval-1', 'approval-2'] } }, res);

    expect(mockGetApprovalById).toHaveBeenCalledWith('approval-1');
  });
});

describe('decision preconditions', () => {
  beforeEach(() => {
    mockGetContainer.mockReturnValue(createContainer());
  });

  test.each(DECISION_PATHS)('%s 404s for an id no row carries', async (path) => {
    mockDecideApprovalIfPending.mockReturnValue({ status: 'not-found' });

    const { status, body } = await callDecision(path);

    expect(status).toBe(404);
    expect(body).toStrictEqual({ error: 'Approval not found' });
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    expect(mockAnnounceApprovalEvent).not.toHaveBeenCalled();
  });

  test.each(DECISION_PATHS)('%s 409s when somebody already decided the row', async (path) => {
    mockDecideApprovalIfPending.mockReturnValue({
      status: 'already-decided',
      record: createRecord({ decision: 'approved' }),
    });

    const { status, body } = await callDecision(path);

    expect(status).toBe(409);
    expect(body).toStrictEqual({ error: 'Approval already decided' });
    expect(mockResetApprovalToPending).not.toHaveBeenCalled();
  });

  test.each(DECISION_PATHS)('%s rejects a note that is not a string', async (path) => {
    const { status, body } = await callDecision(path, { body: { note: 12 } });

    expect(status).toBe(400);
    expect(body).toStrictEqual({
      error: 'Invalid note; expected a string of at most 500 characters',
    });
    expect(mockDecideApprovalIfPending).not.toHaveBeenCalled();
  });

  test.each(DECISION_PATHS)('%s rejects a note past 500 characters', async (path) => {
    const { status } = await callDecision(path, { body: { note: 'x'.repeat(501) } });

    expect(status).toBe(400);
    expect(mockDecideApprovalIfPending).not.toHaveBeenCalled();
  });

  test.each(DECISION_PATHS)('%s treats a null note as no note at all', async (path) => {
    await callDecision(path, { body: { note: null } });

    expect(getReservedPatch()).not.toHaveProperty('decisionNote');
  });

  test.each(DECISION_PATHS)('%s treats a blank note as no note at all', async (path) => {
    await callDecision(path, { body: { note: '   ' } });

    expect(getReservedPatch()).not.toHaveProperty('decisionNote');
  });

  test.each(DECISION_PATHS)('%s survives a body that is not an object', async (path) => {
    const { status } = await callDecision(path, { body: 'not-json' });

    expect(status).not.toBe(400);
  });

  test.each(DECISION_PATHS)('%s reads the first value of a repeated id', async (path) => {
    await callDecision(path, { id: ['approval-1', 'approval-2'] });

    expect(mockDecideApprovalIfPending.mock.calls[0][0]).toBe('approval-1');
  });

  test.each(DECISION_PATHS)(
    '%s records the authenticated username against the decision',
    async (path) => {
      await callDecision(path, { user: { username: '  scott  ' }, body: { note: ' hold ' } });

      expect(getReservedPatch()).toMatchObject({ decidedBy: 'scott', decisionNote: 'hold' });
    },
  );

  test.each(DECISION_PATHS)('%s falls back to anonymous with no session user', async (path) => {
    await callDecision(path);

    expect(getReservedPatch()).toMatchObject({ decidedBy: 'anonymous' });
  });

  test.each(DECISION_PATHS)(
    '%s puts the row back and 404s when the container is gone',
    async (path) => {
      mockGetContainer.mockReturnValue(undefined);

      const { status, body } = await callDecision(path);

      expect(status).toBe(404);
      expect(body).toStrictEqual({ error: 'Container not found' });
      expect(mockResetApprovalToPending).toHaveBeenCalledWith('approval-1');
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    },
  );
});

describe('POST /:id/approve', () => {
  beforeEach(() => {
    mockGetContainer.mockReturnValue(createContainer());
  });

  test('dispatches the update and answers exactly what the Update button answers', async () => {
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    const { status, body } = await callDecision('/:id/approve', { body: { note: 'ship it' } });

    expect(mockRequestContainerUpdate).toHaveBeenCalledWith(container);
    expect(status).toBe(202);
    expect(body).toStrictEqual({ message: 'Container update accepted', operationId: 'op-1' });
  });

  test('reserves the row before it dispatches anything', async () => {
    let reservedBeforeDispatch = false;
    mockRequestContainerUpdate.mockImplementation(() => {
      reservedBeforeDispatch = mockDecideApprovalIfPending.mock.calls.length === 1;
      return Promise.resolve({ operationId: 'op-1' });
    });

    await callDecision('/:id/approve');

    expect(reservedBeforeDispatch).toBe(true);
    expect(getReservedPatch()).toMatchObject({ decision: 'approved' });
  });

  test('links the row to the operation and records the decision', async () => {
    await callDecision('/:id/approve', { user: { username: 'scott' }, body: { note: 'ship it' } });

    expect(mockUpdateApproval).toHaveBeenCalledWith('approval-1', { operationId: 'op-1' });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update-approved',
        status: 'success',
        fromVersion: '1.2.3',
        toVersion: '1.2.4',
      }),
    );
    expect(getAuditDetails()).toStrictEqual({
      approvalId: 'approval-1',
      containerId: 'container-1',
      decision: 'approved',
      decidedBy: 'scott',
      note: 'ship it',
      operationId: 'op-1',
    });
    expect(mockAnnounceApprovalEvent).toHaveBeenCalledWith(
      'decided',
      expect.objectContaining({ decision: 'approved', operationId: 'op-1' }),
    );
  });

  test('refuses before reserving anything when container actions are disabled', async () => {
    mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

    const { status, body } = await callDecision('/:id/approve');

    expect(status).toBe(403);
    expect(body).toStrictEqual({ error: 'Container actions are disabled' });
    expect(mockDecideApprovalIfPending).not.toHaveBeenCalled();
  });

  // Edge cases 3, 11, 13 and 15: every one of these is the admission path's own rejection,
  // re-evaluated at decision time. The queue never invents an admission it could not
  // already perform, and never softens one it could not.
  test.each([
    [409, 'Update mode is notify; Drydock will not apply updates'],
    [
      409,
      'Last update attempt rolled back. The same target image is blocked until a newer image is available.',
    ],
    [409, 'Container update already in progress'],
    [400, 'No update available for this container'],
    [404, 'Container is managed by agent edge-1'],
    [409, 'Self-update is not available for this container'],
  ])('passes a %s admission rejection through unchanged', async (statusCode, message) => {
    mockRequestContainerUpdate.mockRejectedValue(new UpdateRequestError(statusCode, message));

    const { status, body } = await callDecision('/:id/approve');

    expect(status).toBe(statusCode);
    expect(body).toStrictEqual({ error: message });
    expect(mockResetApprovalToPending).toHaveBeenCalledWith('approval-1');
    expect(mockUpdateApproval).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    expect(mockAnnounceApprovalEvent).not.toHaveBeenCalled();
  });

  test('reports an unexpected dispatch failure as the same 500 the Update button reports', async () => {
    mockRequestContainerUpdate.mockRejectedValue(new Error('accept blew up'));

    const { status, body } = await callDecision('/:id/approve');

    expect(status).toBe(500);
    expect(body).toStrictEqual({ error: 'Unable to accept container update' });
    expect(mockResetApprovalToPending).toHaveBeenCalledWith('approval-1');
  });

  // Edge case 5. The reservation is written before anything is awaited, so the second
  // caller cannot pass the compare even though both entered before either dispatched.
  test('two concurrent approves produce one operation and one 409', async () => {
    let pending = true;
    mockDecideApprovalIfPending.mockImplementation(
      (_id: string, patch: Partial<ApprovalRecord>) => {
        if (!pending) {
          return { status: 'already-decided', record: createRecord({ decision: 'approved' }) };
        }
        pending = false;
        return { status: 'decided', record: { ...createRecord(), ...patch } };
      },
    );
    const handler = getPostHandler('/:id/approve');
    const first = createMockResponse();
    const second = createMockResponse();

    await Promise.all([
      handler({ params: { id: 'approval-1' }, body: {} }, first),
      handler({ params: { id: 'approval-1' }, body: {} }, second),
    ]);

    expect(mockRequestContainerUpdate).toHaveBeenCalledTimes(1);
    const statuses = [first, second].map((res) => vi.mocked(res.status).mock.calls[0][0]).sort();
    expect(statuses).toStrictEqual([202, 409]);
  });
});

describe('POST /:id/reject', () => {
  beforeEach(() => {
    mockGetContainer.mockReturnValue(createContainer());
  });

  // Edge case 16: rejecting is the container panel's Skip button, not a queue-local flag.
  test('writes the existing skip policy and records the rejection', async () => {
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    const { status, body } = await callDecision('/:id/reject', { user: { username: 'scott' } });

    expect(mockApplyContainerUpdatePolicyAction).toHaveBeenCalledWith(
      container,
      'skip-current',
      {},
    );
    expect(status).toBe(200);
    expect(body.approval).toMatchObject({ decision: 'rejected', decidedBy: 'scott' });
    expect(getAuditDetails()).toStrictEqual({
      approvalId: 'approval-1',
      containerId: 'container-1',
      decision: 'rejected',
      decidedBy: 'scott',
    });
    expect(mockAnnounceApprovalEvent).toHaveBeenCalledWith(
      'decided',
      expect.objectContaining({ decision: 'rejected' }),
    );
  });

  test('puts the row back when the policy layer refuses the skip', async () => {
    mockApplyContainerUpdatePolicyAction.mockReturnValue({
      error: 'No current update available to skip',
    });

    const { status, body } = await callDecision('/:id/reject');

    expect(status).toBe(400);
    expect(body).toStrictEqual({ error: 'No current update available to skip' });
    expect(mockResetApprovalToPending).toHaveBeenCalledWith('approval-1');
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /:id/defer', () => {
  beforeEach(() => {
    mockGetContainer.mockReturnValue(createContainer());
  });

  // Decision 4: one value, written to both, so the row and the `snoozed` soft blocker can
  // never disagree about when the hold ends.
  test('snoozes the container to the same instant the row is deferred to', async () => {
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    const { status, body } = await callDecision('/:id/defer', {
      body: { until: '2026-09-09T00:00:00.000Z', note: 'after the freeze' },
    });

    expect(mockApplyContainerUpdatePolicyAction).toHaveBeenCalledWith(container, 'snooze', {
      snoozeUntil: '2026-09-09T00:00:00.000Z',
    });
    expect(status).toBe(200);
    expect(body.approval).toMatchObject({
      decision: 'deferred',
      deferredUntil: '2026-09-09T00:00:00.000Z',
    });
    expect(getAuditDetails()).toStrictEqual({
      approvalId: 'approval-1',
      containerId: 'container-1',
      decision: 'deferred',
      decidedBy: 'anonymous',
      note: 'after the freeze',
      deferredUntil: '2026-09-09T00:00:00.000Z',
    });
  });

  test('takes a day count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-09-02T00:00:00.000Z'));

    try {
      await callDecision('/:id/defer', { body: { days: 3 } });
    } finally {
      vi.useRealTimers();
    }

    expect(getReservedPatch()).toMatchObject({ deferredUntil: '2026-09-05T00:00:00.000Z' });
  });

  test('defaults to the snooze primitive default of seven days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-09-02T00:00:00.000Z'));

    try {
      await callDecision('/:id/defer', { body: {} });
    } finally {
      vi.useRealTimers();
    }

    expect(getReservedPatch()).toMatchObject({ deferredUntil: '2026-09-09T00:00:00.000Z' });
  });

  test.each([
    [{ until: 'not-a-date' }, 'Invalid snoozeUntil date'],
    [{ days: 0 }, 'Invalid snooze days value'],
    [{ days: 366 }, 'Invalid snooze days value'],
    [{ days: 'soon' }, 'Invalid snooze days value'],
  ])('refuses %o with the snooze primitive message', async (body, message) => {
    const { status, body: responseBody } = await callDecision('/:id/defer', { body });

    expect(status).toBe(400);
    expect(responseBody).toStrictEqual({ error: message });
    expect(mockDecideApprovalIfPending).not.toHaveBeenCalled();
  });

  test('puts the row back when the policy layer refuses the snooze', async () => {
    mockApplyContainerUpdatePolicyAction.mockReturnValue({
      error: 'Failed to update container policy',
    });

    const { status, body } = await callDecision('/:id/defer', { body: { days: 1 } });

    expect(status).toBe(400);
    expect(body).toStrictEqual({ error: 'Failed to update container policy' });
    expect(mockResetApprovalToPending).toHaveBeenCalledWith('approval-1');
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });
});

// Edge case 15. `notify` means Drydock will not apply updates, so the admission path 409s
// every approve and the queue does not pretend otherwise. Reject and defer are pure policy
// writes that touch no container, so both stay live.
describe('under updateMode notify', () => {
  beforeEach(() => {
    mockGetContainer.mockReturnValue(createContainer());
    mockRequestContainerUpdate.mockRejectedValue(
      new UpdateRequestError(409, 'Update mode is notify; Drydock will not apply updates'),
    );
  });

  test('approve returns the existing 409 and dispatches nothing durable', async () => {
    const { status, body } = await callDecision('/:id/approve');

    expect(status).toBe(409);
    expect(body).toStrictEqual({
      error: 'Update mode is notify; Drydock will not apply updates',
    });
    expect(mockUpdateApproval).not.toHaveBeenCalled();
  });

  test.each([
    ['/:id/reject', 'skip-current'],
    ['/:id/defer', 'snooze'],
  ])('%s still writes policy and returns 200', async (path, action) => {
    const { status } = await callDecision(path, { body: { days: 1 } });

    expect(status).toBe(200);
    expect(mockApplyContainerUpdatePolicyAction).toHaveBeenCalledWith(
      expect.anything(),
      action,
      expect.anything(),
    );
  });
});

describe('OpenAPI contract', () => {
  function expectValid(path: string, payload: unknown) {
    const validation = validateOpenApiJsonResponse({
      path,
      method: 'get',
      statusCode: '200',
      payload,
    });
    expect(validation.errors).toStrictEqual([]);
    expect(validation.valid).toBe(true);
  }

  test('documents the three read routes', () => {
    const operationIds = [
      '/api/v1/approvals',
      '/api/v1/approvals/summary',
      '/api/v1/approvals/{id}',
    ].map((path) => openApiDocument.paths[path]?.get?.operationId);

    expect(operationIds).toStrictEqual(['listApprovals', 'getApprovalSummary', 'getApproval']);
  });

  test('documents the three decision routes', () => {
    const operationIds = ['approve', 'reject', 'defer'].map(
      (action) => openApiDocument.paths[`/api/v1/approvals/{id}/${action}`]?.post?.operationId,
    );

    expect(operationIds).toStrictEqual(['approveApproval', 'rejectApproval', 'deferApproval']);
  });

  test('approve answers with the same schema the container update endpoint answers with', () => {
    const approve = openApiDocument.paths['/api/v1/approvals/{id}/approve'].post;
    const containerUpdate = openApiDocument.paths['/api/v1/containers/{id}/update'].post;

    expect(approve.responses[202].content['application/json'].schema).toStrictEqual(
      containerUpdate.responses[202].content['application/json'].schema,
    );
  });

  test('the list response matches ApprovalListResult', () => {
    mockListApprovals.mockReturnValue({
      records: [
        createRecord({
          agent: 'edge-1',
          releaseNotesUrl: 'https://example.test/notes',
          scanCritical: 0,
          scanHigh: 2,
          scanMedium: 0,
          scanLow: 0,
          scanUnknown: 0,
          scanAt: '2026-08-29T00:00:00.000Z',
          decision: 'deferred',
          deferredUntil: '2026-09-05T00:00:00.000Z',
          decidedAt: '2026-08-29T00:30:00.000Z',
          decidedBy: 'scott',
          decisionNote: 'waiting on the upstream fix',
          operationId: 'op-1',
          outcome: 'applied',
          resolvedAt: '2026-08-29T01:00:00.000Z',
          resolution: 'superseded',
        }),
      ],
      total: 4,
    });

    expectValid('/api/v1/approvals', callList({ limit: '1' }).body);
  });

  test('the summary response matches ApprovalSummary', () => {
    const res = createMockResponse();
    getHandler('/summary')({}, res);

    expectValid('/api/v1/approvals/summary', vi.mocked(res.json).mock.calls[0][0]);
  });

  test.each([
    ['approve', 202],
    ['reject', 200],
    ['defer', 200],
  ])('the %s response matches its documented schema', async (action, statusCode) => {
    mockGetContainer.mockReturnValue(createContainer());
    const { body } = await callDecision(`/:id/${action}`, {});

    const validation = validateOpenApiJsonResponse({
      path: `/api/v1/approvals/{id}/${action}`,
      method: 'post',
      statusCode: String(statusCode),
      payload: body,
    });
    expect(validation.errors).toStrictEqual([]);
    expect(validation.valid).toBe(true);
  });

  test('the detail response matches ApprovalDetail', () => {
    mockGetApprovalById.mockReturnValue(createRecord());
    mockGetContainer.mockReturnValue(
      createContainer({ updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' } }),
    );
    const res = createMockResponse();

    getHandler('/:id')({ params: { id: 'approval-1' } }, res);

    expectValid('/api/v1/approvals/{id}', vi.mocked(res.json).mock.calls[0][0]);
  });
});
