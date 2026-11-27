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

    const query = mockGetAuditEntries.mock.calls[0][0];
    expect(query).not.toHaveProperty('action');
    expect(query).not.toHaveProperty('actions');
    expect(query).not.toHaveProperty('container');
    expect(query).not.toHaveProperty('from');
    expect(query).not.toHaveProperty('to');
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
        self: '/api/v1/audit?limit=50&offset=0',
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
        self: '/api/v1/audit?action=update-applied&container=redis&from=2024-01-01&to=2024-12-31&limit=10&offset=10',
      },
    });
  });

  test('should ignore empty action and container filters', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        action: '',
        container: '',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    const query = mockGetAuditEntries.mock.calls[0][0];
    expect(query).not.toHaveProperty('action');
    expect(query).not.toHaveProperty('container');
    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should ignore empty from and to date filters', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        from: '',
        to: '',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    const query = mockGetAuditEntries.mock.calls[0][0];
    expect(query).not.toHaveProperty('from');
    expect(query).not.toHaveProperty('to');
    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
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

  test('should ignore non-array indexed values for offset and limit', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        offset: { 0: '40' },
        limit: { 0: '20' },
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should ignore array offset and limit values when the first item is not a string', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({
      query: {
        offset: [40, '99'],
        limit: [20, '99'],
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
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
        self: '/api/v1/audit?limit=50&offset=0',
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
        self: '/api/v1/audit?limit=2&offset=10',
        next: '/api/v1/audit?limit=2&offset=12',
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

  test('should ignore actions parameter containing only commas', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { actions: ',,,' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should fall back to default limit when limit has a numeric prefix followed by trailing characters', () => {
    // Number.parseInt('25logs', 10) === 25, which used to slip past validation
    // as a legitimate limit instead of falling back to the default. Audit's
    // contract is to fall back rather than 400 on a bad value (see the decision
    // note in audit.ts), so an unparseable value should behave the same as an
    // absent one, not silently truncate to whatever digits happen to lead it.
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { limit: '25logs' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should fall back to default offset when offset has a numeric prefix followed by trailing characters', () => {
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { offset: '10ms' } });
    const res = createMockResponse();

    handler(req, res);

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
    });
  });

  test('should fall back to default limit when limit exceeds Number.MAX_SAFE_INTEGER', () => {
    // Passes the old Number.parseInt-based check but loses precision, so
    // Number.isSafeInteger must reject it rather than clamping the rounded
    // (wrong) value to the [1, 200] range.
    auditRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });

    const req = createMockRequest({ query: { limit: '99999999999999999999' } });
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

describe('Audit Router actor filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuditEntries.mockReturnValue({ entries: [], total: 0 });
  });

  const listHandler = () => {
    auditRouter.init();
    return mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
  };

  test('passes the actor filter to the store verbatim, including spaces and @', () => {
    const res = createMockResponse();
    listHandler()(createMockRequest({ query: { actor: 'Alice O@example.com' } }), res);
    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      skip: 0,
      limit: 50,
      actor: 'Alice O@example.com',
    });
  });

  test('ignores an empty actor filter', () => {
    listHandler()(createMockRequest({ query: { actor: '' } }), createMockResponse());
    expect(mockGetAuditEntries.mock.calls[0][0]).not.toHaveProperty('actor');
  });

  test.each([
    ['a control character', 'bad\nactor'],
    ['an overlong value', 'a'.repeat(201)],
    ['a non-string value', { $ne: 'x' }],
  ])('returns 400 for %s in the actor filter', (_label, actor) => {
    const res = createMockResponse();
    listHandler()(createMockRequest({ query: { actor } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGetAuditEntries).not.toHaveBeenCalled();
  });
});

describe('Audit Router export', () => {
  const entry = {
    id: '1',
    timestamp: '2026-01-01T00:00:00.000Z',
    action: 'update-applied',
    containerName: 'web',
    status: 'success',
    actor: 'alice',
    actorRole: 'operator',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuditEntries.mockReturnValue({ entries: [entry], total: 1 });
  });

  const exportHandler = () => {
    auditRouter.init();
    return mockRouter.get.mock.calls.find((c) => c[0] === '/export')[1];
  };

  test('registers the export route', () => {
    auditRouter.init();
    expect(mockRouter.get).toHaveBeenCalledWith('/export', expect.any(Function));
  });

  test('exports CSV by default with a header row, attachment headers and the shared filters', () => {
    const res = createMockResponse();
    exportHandler()(
      createMockRequest({ query: { actor: 'alice', container: 'web', action: 'update-applied' } }),
      res,
    );

    expect(mockGetAuditEntries).toHaveBeenCalledWith({
      actor: 'alice',
      container: 'web',
      action: 'update-applied',
      skip: 0,
      limit: 100000,
    });
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('text/csv; charset=utf-8');
    expect(String(res.getHeader('content-disposition'))).toMatch(
      /^attachment; filename="drydock-audit-[\dT-]+Z\.csv"$/,
    );
    expect(res.getHeader('x-total-count')).toBe('1');
    expect(res.getHeader('x-content-type-options')).toBe('nosniff');
    expect(res.body).toBe(
      'id,timestamp,actor,actorRole,action,containerName,containerIdentityKey,containerImage,fromVersion,toVersion,updateKind,semverDiff,triggerName,status,details\r\n' +
        '1,2026-01-01T00:00:00.000Z,alice,operator,update-applied,web,,,,,,,,success,\r\n',
    );
  });

  test('exports JSON as an array of entries', () => {
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: { format: 'json' } }), res);

    expect(res.getHeader('content-type')).toBe('application/json');
    expect(String(res.getHeader('content-disposition'))).toContain('.json"');
    expect(JSON.parse(res.body as string)).toEqual([entry]);
  });

  test('quotes cells holding commas, quotes and newlines and doubles embedded quotes', () => {
    mockGetAuditEntries.mockReturnValue({
      entries: [{ ...entry, details: 'said "hi", then\nleft', containerName: 'a,b' }],
      total: 1,
    });
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: {} }), res);

    expect(res.body).toContain('"a,b"');
    expect(res.body).toContain('"said ""hi"", then\nleft"');
  });

  test.each([
    ['=', '=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
    ['+', '+1+1', "'+1+1"],
    ['-', '-2+3', "'-2+3"],
    ['@', '@SUM(A1)', "'@SUM(A1)"],
    ['tab', '\tcmd', "'\tcmd"],
    ['carriage return', '\rcmd', `"'\rcmd"`],
  ])('neutralizes a cell starting with %s so a spreadsheet will not run it', (_n, value, cell) => {
    mockGetAuditEntries.mockReturnValue({
      entries: [{ ...entry, details: value, actor: value }],
      total: 1,
    });
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: {} }), res);

    expect((res.body as string).split('\r\n')[1]).toContain(`,${cell},`);
    expect((res.body as string).split('\r\n')[1].endsWith(cell)).toBe(true);
  });

  test('does not touch a formula-looking value in the JSON export', () => {
    mockGetAuditEntries.mockReturnValue({ entries: [{ ...entry, details: '=1+1' }], total: 1 });
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: { format: 'json' } }), res);
    expect(JSON.parse(res.body as string)[0].details).toBe('=1+1');
  });

  test('reports the full match count when the export is capped', () => {
    mockGetAuditEntries.mockReturnValue({ entries: [entry], total: 250000 });
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: {} }), res);
    expect(res.getHeader('x-total-count')).toBe('250000');
  });

  test('returns 400 for an unknown format', () => {
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: { format: 'xml' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGetAuditEntries).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid filter', () => {
    const res = createMockResponse();
    exportHandler()(createMockRequest({ query: { container: 'bad name!' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGetAuditEntries).not.toHaveBeenCalled();
  });

  test('requires the read scope: an API key without it is refused, one with it is served', () => {
    const handler = exportHandler();
    const denied = createMockResponse();
    handler(
      createMockRequest({
        query: {},
        principal: { kind: 'api-key', username: 'k', keyId: 'k1', scopes: ['containers:watch'] },
      }),
      denied,
    );
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(mockGetAuditEntries).not.toHaveBeenCalled();

    const allowed = createMockResponse();
    handler(
      createMockRequest({
        query: {},
        principal: { kind: 'api-key', username: 'k', keyId: 'k1', scopes: ['read'] },
      }),
      allowed,
    );
    expect(allowed.statusCode).toBe(200);
  });
});
