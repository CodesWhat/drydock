import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetOperationById } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
  mockGetOperationById: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/update-operation', () => ({
  getOperationById: mockGetOperationById,
}));

import * as updateOperationsRouter from './update-operations.js';

function getHandler(method: string, path: string) {
  updateOperationsRouter.init();
  const call = mockRouter[method].mock.calls.find((c: unknown[]) => c[0] === path);
  return call[call.length - 1];
}

describe('Update Operations Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('should register routes and nocache middleware', () => {
      updateOperationsRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/:id', expect.any(Function));
    });
  });

  describe('getUpdateOperationById', () => {
    test('should return 400 when id param is missing', () => {
      const handler = getHandler('get', '/:id');
      const req = createMockRequest({ params: { id: '' } });
      const res = createMockResponse();
      handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Operation id is required' });
    });

    test('should return 400 when id param is whitespace only', () => {
      const handler = getHandler('get', '/:id');
      const req = createMockRequest({ params: { id: '   ' } });
      const res = createMockResponse();
      handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Operation id is required' });
    });

    test('should return 404 when operation is not found', () => {
      const handler = getHandler('get', '/:id');
      mockGetOperationById.mockReturnValue(undefined);
      const req = createMockRequest({ params: { id: 'op-missing' } });
      const res = createMockResponse();
      handler(req, res);
      expect(mockGetOperationById).toHaveBeenCalledWith('op-missing');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Update operation not found' });
    });

    test('should return 200 with the operation when found', () => {
      const handler = getHandler('get', '/:id');
      const operation = { id: 'op-1', status: 'succeeded', containerName: 'nginx' };
      mockGetOperationById.mockReturnValue(operation);
      const req = createMockRequest({ params: { id: 'op-1' } });
      const res = createMockResponse();
      handler(req, res);
      expect(mockGetOperationById).toHaveBeenCalledWith('op-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(operation);
    });

    test('should trim whitespace from id before lookup', () => {
      const handler = getHandler('get', '/:id');
      const operation = { id: 'op-1', status: 'failed', containerName: 'redis' };
      mockGetOperationById.mockReturnValue(operation);
      const req = createMockRequest({ params: { id: '  op-1  ' } });
      const res = createMockResponse();
      handler(req, res);
      expect(mockGetOperationById).toHaveBeenCalledWith('op-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(operation);
    });
  });
});
