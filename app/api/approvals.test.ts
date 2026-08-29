/**
 * Tests for the pending-approval read API (spec-ca-2-approval-queue.md, slice 3).
 *
 * The store is doubled because its query semantics have their own tests; eligibility is
 * not, so the detail route's hold reasons are the real ones `computeUpdateEligibility`
 * produces for the fixture container.
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
  mockGetContainer,
  mockBuildEligibilityContext,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
  mockListApprovals: vi.fn(),
  mockCountApprovals: vi.fn(),
  mockGetApprovalById: vi.fn(),
  mockGetContainer: vi.fn(),
  mockBuildEligibilityContext: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));
vi.mock('../store/approval.js', () => ({
  listApprovals: mockListApprovals,
  countApprovals: mockCountApprovals,
  getApprovalById: mockGetApprovalById,
}));
vi.mock('../store/container.js', () => ({ getContainer: mockGetContainer }));
vi.mock('./sse-container-enrichment.js', () => ({
  buildEligibilityContext: mockBuildEligibilityContext,
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

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
