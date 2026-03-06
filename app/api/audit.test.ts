import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetAuditEntries } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
  mockGetAuditEntries: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/audit', () => ({
  getAuditEntries: mockGetAuditEntries,
}));

import * as auditRouter from './audit.js';

describe('Audit Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and route', () => {
    const router = auditRouter.init();
    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should return audit entries with default pagination', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const mockResult = {
      entries: [{ id: '1', action: 'update-available', containerName: 'nginx' }],
      total: 1,
    };
    mockGetAuditEntries.mockReturnValue(mockResult);

    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      entries: mockResult.entries,
      total: 1,
      page: 1,
      limit: 50,
    });
  });

  test('should pass query filters to store', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        page: '2',
        limit: '10',
        action: 'update-applied',
        container: 'redis',
        from: '2024-01-01',
        to: '2024-12-31',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 10,
      limit: 10,
      action: 'update-applied',
      container: 'redis',
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(res.json).toHaveBeenCalledWith({
      entries: [],
      total: 0,
      page: 2,
      limit: 10,
    });
  });

  test('should accept first value when page/limit are provided as query arrays', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        page: ['3', '99'],
        limit: ['20', '99'],
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 40,
      limit: 20,
    });
  });

  test('should clamp page to minimum of 1', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { page: '-5' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  test('should clamp limit to maximum of 200', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { limit: '500' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 200,
    });
  });

  test('should clamp limit to minimum of 1', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { limit: '0' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 1,
    });
  });

  test('should return 400 when action query parameter is not a string', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const req = createMockRequest({ query: { action: ['update-applied'] } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid action query parameter' });
  });

  test('should return 400 when container query parameter contains unsafe characters', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const req = createMockRequest({ query: { container: 'redis;drop table' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid container query parameter' });
  });
});
