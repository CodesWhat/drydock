/**
 * The release gate for spec-ca-2-approval-queue.md slice 4: an approve that the manual
 * Update button would reject returns the same status code and the same message.
 *
 * Both handlers are driven in one file against one `requestContainerUpdate` double, and
 * the assertion compares the two responses to each other rather than to a literal. A test
 * that pinned each side to its own expected string would keep passing the day one of them
 * gained a case the other did not — which is the whole failure this exists to catch, since
 * the queue's promise is that it admits exactly what the button admits and nothing else.
 */
import type { ApprovalRecord } from '../model/approval.js';
import type { Container } from '../model/container.js';
import { createMockResponse } from '../test/helpers.js';

const {
  mockRouter,
  mockGetContainer,
  mockRequestContainerUpdate,
  mockGetServerConfiguration,
  mockDecideApprovalIfPending,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockRequestContainerUpdate: vi.fn(),
  mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
  mockDecideApprovalIfPending: vi.fn(),
}));

vi.mock('express', () => ({ default: { Router: vi.fn(() => mockRouter) } }));
vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));
vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  updateContainer: vi.fn((container) => container),
}));
vi.mock('../registry/index.js', () => ({ getState: vi.fn(() => ({ trigger: {} })) }));
vi.mock('../agent/manager.js', () => ({ getAgent: vi.fn() }));
vi.mock('../prometheus/container-actions.js', () => ({
  getContainerActionsCounter: vi.fn(() => undefined),
}));
vi.mock('../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../configuration/index.js')>()),
  getServerConfiguration: mockGetServerConfiguration,
}));
vi.mock('../updates/request-update.js', () => ({
  requestContainerUpdate: mockRequestContainerUpdate,
  requestContainerUpdates: vi.fn(),
  UpdateRequestError: class UpdateRequestError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('../store/approval.js', () => ({
  listApprovals: vi.fn(),
  countApprovals: vi.fn(),
  getApprovalById: vi.fn(),
  decideApprovalIfPending: mockDecideApprovalIfPending,
  resetApprovalToPending: vi.fn(),
  updateApproval: vi.fn(),
}));
vi.mock('../approvals/events.js', () => ({ announceApprovalEvent: vi.fn() }));
vi.mock('./container/update-policy-writer.js', () => ({
  applyContainerUpdatePolicyAction: vi.fn((container) => ({ container })),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import { UpdateRequestError } from '../updates/request-update.js';
import * as approvalsRouter from './approvals.js';
import * as containerActionsRouter from './container-actions.js';

const CONTAINER: Container = {
  id: 'container-1',
  name: 'nginx',
  watcher: 'local',
  image: { name: 'library/nginx' },
} as Container;

const APPROVAL: ApprovalRecord = {
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
};

function getPostHandler(register: () => unknown, path: string) {
  mockRouter.post.mockClear();
  register();
  return mockRouter.post.mock.calls.find((call) => call[0] === path)?.[1];
}

async function call(handler: (req: unknown, res: unknown) => unknown, params: unknown) {
  const res = createMockResponse();
  await handler({ params, body: {}, query: {} }, res);
  return {
    status: vi.mocked(res.status).mock.calls[0][0],
    body: vi.mocked(res.json).mock.calls[0][0],
  };
}

/** The manual Update button: `POST /api/v1/containers/:id/update`. */
function updateButton() {
  return call(getPostHandler(containerActionsRouter.init, '/:id/update'), { id: 'container-1' });
}

/** The queue's approve decision. */
function queueApprove() {
  return call(getPostHandler(approvalsRouter.init, '/:id/approve'), { id: 'approval-1' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetContainer.mockReturnValue(CONTAINER);
  mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: true } });
  mockRequestContainerUpdate.mockResolvedValue({ operationId: 'op-1' });
  mockDecideApprovalIfPending.mockImplementation((_id: string, patch: Partial<ApprovalRecord>) => ({
    status: 'decided',
    record: { ...APPROVAL, ...patch },
  }));
});

describe('approve is the manual update button', () => {
  test('an accepted update answers identically', async () => {
    const button = await updateButton();
    const approve = await queueApprove();

    expect(approve).toStrictEqual(button);
    expect(approve).toStrictEqual({
      status: 202,
      body: { message: 'Container update accepted', operationId: 'op-1' },
    });
  });

  // One row per rejection the admission path can produce for a container that has a row in
  // the queue. Edge case 3 (rolled back), 11 (agent mismatch), 13 (self-update) and 15
  // (notify mode) are the named ones; the rest are the other reasons the same path throws.
  test.each([
    [409, 'Update mode is notify; Drydock will not apply updates'],
    [409, 'Container update already queued'],
    [409, 'Container update already in progress'],
    [
      409,
      'Last update attempt rolled back. The same target image is blocked until a newer image is available.',
    ],
    [409, 'Self-update is not available while running outside a container'],
    [409, 'Vulnerability scan blocked this update'],
    [400, 'No update available for this container'],
    [404, 'Container is managed by agent edge-1, which is not connected'],
    [404, 'No docker trigger found for this container'],
  ])('a %i rejection answers identically', async (statusCode, message) => {
    mockRequestContainerUpdate.mockRejectedValue(new UpdateRequestError(statusCode, message));

    const button = await updateButton();
    const approve = await queueApprove();

    expect(approve).toStrictEqual(button);
    expect(approve).toStrictEqual({ status: statusCode, body: { error: message } });
  });

  test('an unexpected failure answers identically', async () => {
    mockRequestContainerUpdate.mockRejectedValue(new Error('accept blew up'));

    const button = await updateButton();
    const approve = await queueApprove();

    expect(approve).toStrictEqual(button);
    expect(approve.status).toBe(500);
  });

  test('the container actions feature gate answers identically', async () => {
    mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

    const button = await updateButton();
    const approve = await queueApprove();

    expect(approve).toStrictEqual(button);
    expect(approve).toStrictEqual({
      status: 403,
      body: { error: 'Container actions are disabled' },
    });
  });

  test('a missing container answers identically', async () => {
    mockGetContainer.mockReturnValue(undefined);

    const button = await updateButton();
    const approve = await queueApprove();

    expect(approve).toStrictEqual(button);
    expect(approve).toStrictEqual({ status: 404, body: { error: 'Container not found' } });
  });
});
