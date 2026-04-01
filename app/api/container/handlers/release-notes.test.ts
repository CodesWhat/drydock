import { createMockRequest, createMockResponse } from '../../../test/helpers.js';
import { createGetContainerReleaseNotesHandler } from './release-notes.js';

vi.mock('../../../release-notes/index.js', () => ({
  getFullReleaseNotesForContainer: vi.fn(),
}));

vi.mock('../../error-response.js', () => ({
  sendErrorResponse: vi.fn(),
}));

vi.mock('./common.js', () => ({
  getContainerOrNotFound: vi.fn(),
}));

vi.mock('../request-helpers.js', () => ({
  getPathParamValue: vi.fn((v: string) => v),
}));

import { getFullReleaseNotesForContainer } from '../../../release-notes/index.js';
import { sendErrorResponse } from '../../error-response.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { getContainerOrNotFound } from './common.js';

const mockGetFullReleaseNotes = vi.mocked(getFullReleaseNotesForContainer);
const mockSendErrorResponse = vi.mocked(sendErrorResponse);
const mockGetContainerOrNotFound = vi.mocked(getContainerOrNotFound);

function createMockContext(overrides: Partial<CrudHandlerContext> = {}): CrudHandlerContext {
  return {
    getContainersFromStore: vi.fn(),
    getContainerCountFromStore: vi.fn(),
    storeContainer: { getContainer: vi.fn(), deleteContainer: vi.fn() },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(),
      getInProgressOperationByContainerName: vi.fn(),
    },
    getServerConfiguration: vi.fn(),
    getAgent: vi.fn(),
    getWatchers: vi.fn(),
    getErrorMessage: vi.fn((e: unknown) => String(e)),
    getErrorStatusCode: vi.fn(),
    redactContainerRuntimeEnv: vi.fn(),
    redactContainersRuntimeEnv: vi.fn(),
    ...overrides,
  };
}

function createMockReqRes(id = 'test-id') {
  const req = createMockRequest({ params: { id } });
  const res = createMockResponse();
  return { req, res };
}

describe('createGetContainerReleaseNotesHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns early when container is not found', async () => {
    mockGetContainerOrNotFound.mockReturnValue(undefined);
    const context = createMockContext();
    const handler = createGetContainerReleaseNotesHandler(context);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(mockGetContainerOrNotFound).toHaveBeenCalledWith(context, 'test-id', res);
    expect(mockGetFullReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns 404 when release notes are not available', async () => {
    const container = { id: 'test-id', name: 'test' };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetFullReleaseNotes.mockResolvedValue(undefined as never);
    const context = createMockContext();
    const handler = createGetContainerReleaseNotesHandler(context);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 404, 'Release notes not available');
  });

  test('returns 200 with release notes when available', async () => {
    const container = { id: 'test-id', name: 'test' };
    const releaseNotes = { version: '2.0.0', body: 'New stuff' };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetFullReleaseNotes.mockResolvedValue(releaseNotes as never);
    const context = createMockContext();
    const handler = createGetContainerReleaseNotesHandler(context);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(releaseNotes);
    expect(mockSendErrorResponse).not.toHaveBeenCalled();
  });

  test('returns 500 when getFullReleaseNotesForContainer throws', async () => {
    const container = { id: 'test-id', name: 'test' };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetFullReleaseNotes.mockRejectedValue(new Error('fetch failed'));
    const context = createMockContext({
      getErrorMessage: vi.fn(() => 'fetch failed'),
    });
    const handler = createGetContainerReleaseNotesHandler(context);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      500,
      'Error retrieving release notes (fetch failed)',
    );
  });
});
