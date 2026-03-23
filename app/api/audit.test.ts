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
import * as paginationLinks from './pagination-links.js';

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
      data: mockResult.entries,
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
      _links: {
        self: '/api/audit?limit=50&offset=0',
      },
    });
  });

  test('should pass query filters to store', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        offset: '10',
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
      data: [],
      total: 0,
      limit: 10,
      offset: 10,
      hasMore: false,
      _links: {
        self: '/api/audit?action=update-applied&container=redis&from=2024-01-01&to=2024-12-31&limit=10&offset=10',
      },
    });
  });

  test('should accept first value when offset/limit are provided as query arrays', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        offset: ['40', '99'],
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

  test('should clamp offset to minimum of 0', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { offset: '-5' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
    expect(res.json).toHaveBeenCalledWith({
      data: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
      _links: {
        self: '/api/audit?limit=50&offset=0',
      },
    });
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

  test('should set hasMore when more entries remain after current offset window', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({
      entries: [{ id: 'a-1' }, { id: 'a-2' }],
      total: 20,
    });

    const req = createMockRequest({
      query: {
        offset: '10',
        limit: '2',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: 'a-1' }, { id: 'a-2' }],
      total: 20,
      limit: 2,
      offset: 10,
      hasMore: true,
      _links: {
        self: '/api/audit?limit=2&offset=10',
        next: '/api/audit?limit=2&offset=12',
      },
    });
  });

  test('should omit _links when pagination link builder returns undefined', () => {
    const paginationSpy = vi
      .spyOn(paginationLinks, 'buildPaginationLinks')
      .mockReturnValue(undefined);
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({
      entries: [{ id: 'a-1' }],
      total: 1,
    });

    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: 'a-1' }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    paginationSpy.mockRestore();
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

  test('should pass actions filter as array to store', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        actions: 'update-available,security-alert,agent-disconnect',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
      actions: ['update-available', 'security-alert', 'agent-disconnect'],
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('should return 400 when actions parameter contains unsafe characters', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const req = createMockRequest({
      query: { actions: 'update-available,evil;drop' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid actions query parameter' });
  });

  test('should ignore empty actions parameter', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { actions: '' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should prefer action over actions when both provided', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        action: 'update-applied',
        actions: 'update-available,security-alert',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
      action: 'update-applied',
      actions: ['update-available', 'security-alert'],
    });
  });
});
