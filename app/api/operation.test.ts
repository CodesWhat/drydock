import { createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetOperationById, mockRequestOperationCancellation } = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  mockGetOperationById: vi.fn(),
  mockRequestOperationCancellation: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/update-operation', () => ({
  getOperationById: mockGetOperationById,
  requestOperationCancellation: mockRequestOperationCancellation,
}));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import * as operationRouter from './operation.js';

describe('Operation Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and cancel route', () => {
    const router = operationRouter.init();

    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.post).toHaveBeenCalledWith('/:id/cancel', expect.any(Function));
  });

  describe('POST /:id/cancel', () => {
    function getHandler() {
      operationRouter.init();
      return mockRouter.post.mock.calls.find((c) => c[0] === '/:id/cancel')[1];
    }

    test('returns 404 when operation is not found', () => {
      mockGetOperationById.mockReturnValue(undefined);
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'missing-op' } }, res);

      expect(mockGetOperationById).toHaveBeenCalledWith('missing-op');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Operation not found' });
    });

    test('returns 409 when operation is already terminal', () => {
      mockGetOperationById.mockReturnValue({ id: 'op-1', status: 'succeeded' });
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'op-1' } }, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Operation is not active',
        status: 'succeeded',
      });
    });

    test('returns 200 with cancelled operation when queued', () => {
      const queued = { id: 'op-2', status: 'queued', containerName: 'web' };
      const cancelled = {
        id: 'op-2',
        status: 'failed',
        phase: 'failed',
        lastError: 'Cancelled by operator',
        completedAt: '2026-04-29T00:00:00.000Z',
        containerName: 'web',
      };
      mockGetOperationById.mockReturnValue(queued);
      mockRequestOperationCancellation.mockReturnValue({
        outcome: 'cancelled',
        operation: cancelled,
      });
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'op-2' } }, res);

      expect(mockRequestOperationCancellation).toHaveBeenCalledWith('op-2');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: cancelled });
    });

    test('returns 202 with cancel-requested operation when in-progress', () => {
      const inProgress = { id: 'op-3', status: 'in-progress', containerName: 'web' };
      const flagged = {
        id: 'op-3',
        status: 'in-progress',
        phase: 'pulling',
        cancelRequested: true,
        containerName: 'web',
      };
      mockGetOperationById.mockReturnValue(inProgress);
      mockRequestOperationCancellation.mockReturnValue({
        outcome: 'cancel-requested',
        operation: flagged,
      });
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'op-3' } }, res);

      expect(mockRequestOperationCancellation).toHaveBeenCalledWith('op-3');
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ data: flagged });
    });

    test('returns 404 when requestOperationCancellation returns undefined after pre-check', () => {
      mockGetOperationById.mockReturnValue({ id: 'op-4', status: 'queued' });
      mockRequestOperationCancellation.mockReturnValue(undefined);
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'op-4' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Operation not found' });
    });

    test('returns 500 when store throws', () => {
      mockGetOperationById.mockImplementation(() => {
        throw new Error('store exploded');
      });
      const handler = getHandler();
      const res = createMockResponse();

      handler({ params: { id: 'op-5' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });
});
