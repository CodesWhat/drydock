import { createMockRequest, createMockResponse } from '../../../test/helpers.js';
import { createGetContainerIntermediateReleaseNotesHandler } from './intermediate-release-notes.js';

vi.mock('../../../release-notes/index.js', () => ({
  getIntermediateReleaseNotes: vi.fn(),
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

import { getIntermediateReleaseNotes } from '../../../release-notes/index.js';
import { sendErrorResponse } from '../../error-response.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { getContainerOrNotFound } from './common.js';

const mockGetIntermediateReleaseNotes = vi.mocked(getIntermediateReleaseNotes);
const mockSendErrorResponse = vi.mocked(sendErrorResponse);
const mockGetContainerOrNotFound = vi.mocked(getContainerOrNotFound);

function createMockContext(overrides: Partial<CrudHandlerContext> = {}): CrudHandlerContext {
  return {
    getContainersFromStore: vi.fn(),
    getContainerCountFromStore: vi.fn(),
    storeContainer: { getContainer: vi.fn(), deleteContainer: vi.fn() },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(),
      getOperationsByContainerId: vi.fn(() => []),
      getInProgressOperationByContainerName: vi.fn(),
      getInProgressOperationByContainerId: vi.fn(),
      getActiveOperationByContainerName: vi.fn(),
      getActiveOperationByContainerId: vi.fn(),
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

function createMockReqRes(id = 'test-id', query: Record<string, unknown> = {}) {
  const req = createMockRequest({ params: { id }, query });
  const res = createMockResponse();
  return { req, res };
}

describe('createGetContainerIntermediateReleaseNotesHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns early when container is not found', async () => {
    mockGetContainerOrNotFound.mockReturnValue(undefined);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0' });

    await handler(req, res);

    expect(mockGetContainerOrNotFound).toHaveBeenCalledWith(context, 'test-id', res);
    expect(mockGetIntermediateReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns 400 when from query param is missing', async () => {
    const container = { id: 'test-id', name: 'test' };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', {});

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      400,
      "Query parameter 'from' is required",
    );
    expect(mockGetIntermediateReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns 400 when from query param is blank whitespace', async () => {
    const container = { id: 'test-id', name: 'test' };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '   ' });

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      400,
      "Query parameter 'from' is required",
    );
    expect(mockGetIntermediateReleaseNotes).not.toHaveBeenCalled();
  });

  test('returns 422 when to is missing and container has no result tag', async () => {
    const container = { id: 'test-id', name: 'test', result: undefined };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0' });

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      422,
      "Cannot determine target tag: provide 'to' or ensure the container has a pending update",
    );
    expect(mockGetIntermediateReleaseNotes).not.toHaveBeenCalled();
  });

  test('uses container result tag as fallback when to query param is missing', async () => {
    const container = { id: 'test-id', name: 'test', result: { tag: '2.0.0' } };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetIntermediateReleaseNotes.mockResolvedValue({ releaseNotes: [], hiddenCount: 0 });
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0' });

    await handler(req, res);

    expect(mockGetIntermediateReleaseNotes).toHaveBeenCalledWith(container, '1.0.0', '2.0.0');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('uses query to param when provided', async () => {
    const container = { id: 'test-id', name: 'test', result: { tag: '3.0.0' } };
    const releaseNotes = [
      {
        title: 'v2.0.0',
        body: 'Major release',
        url: 'https://example.com',
        publishedAt: '2024-01-01',
        provider: 'github',
      },
    ];
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetIntermediateReleaseNotes.mockResolvedValue({ releaseNotes, hiddenCount: 0 });
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0', to: '2.0.0' });

    await handler(req, res);

    expect(mockGetIntermediateReleaseNotes).toHaveBeenCalledWith(container, '1.0.0', '2.0.0');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ releaseNotes, hiddenCount: 0 });
  });

  test('returns 200 with empty releaseNotes array when result is empty', async () => {
    const container = { id: 'test-id', name: 'test', result: { tag: '2.0.0' } };
    const emptyResult = { releaseNotes: [], hiddenCount: 0 };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetIntermediateReleaseNotes.mockResolvedValue(emptyResult);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0', to: '2.0.0' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(emptyResult);
    expect(mockSendErrorResponse).not.toHaveBeenCalled();
  });

  test('returns 200 and echoes release notes with hiddenCount via res.json', async () => {
    const container = { id: 'test-id', name: 'test', result: { tag: '2.0.0' } };
    const resultWithNotes = {
      releaseNotes: [
        {
          title: 'v1.5.0',
          body: 'Patch',
          url: 'https://example.com/v1.5.0',
          publishedAt: '2024-03-01',
          provider: 'github' as const,
        },
        {
          title: 'v2.0.0',
          body: 'Major',
          url: 'https://example.com/v2.0.0',
          publishedAt: '2024-06-01',
          provider: 'github' as const,
        },
      ],
      hiddenCount: 3,
    };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetIntermediateReleaseNotes.mockResolvedValue(resultWithNotes);
    const context = createMockContext();
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0', to: '2.0.0' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(resultWithNotes);
  });

  test('returns 500 when getIntermediateReleaseNotes throws', async () => {
    const container = { id: 'test-id', name: 'test', result: { tag: '2.0.0' } };
    mockGetContainerOrNotFound.mockReturnValue(container as never);
    mockGetIntermediateReleaseNotes.mockRejectedValue(new Error('registry timeout'));
    const context = createMockContext({
      getErrorMessage: vi.fn(() => 'registry timeout'),
    });
    const handler = createGetContainerIntermediateReleaseNotesHandler(context);
    const { req, res } = createMockReqRes('test-id', { from: '1.0.0', to: '2.0.0' });

    await handler(req, res);

    expect(mockSendErrorResponse).toHaveBeenCalledWith(
      res,
      500,
      'Error retrieving intermediate release notes (registry timeout)',
    );
  });
});
