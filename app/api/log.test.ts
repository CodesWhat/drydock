import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetComponents, mockGetEntries, mockGetLogLevel, mockGetLogBufferEnabled } =
  vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn() },
    mockGetComponents: vi.fn(),
    mockGetEntries: vi.fn(),
    mockGetLogLevel: vi.fn(() => 'info'),
    mockGetLogBufferEnabled: vi.fn(() => true),
  }));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../configuration', () => ({
  getLogLevel: mockGetLogLevel,
  getLogBufferEnabled: mockGetLogBufferEnabled,
}));

vi.mock('../log/buffer', () => ({
  getComponents: mockGetComponents,
  getEntries: mockGetEntries,
}));

import { getLogLevel } from '../configuration/index.js';
import * as logRouter from './log.js';

function createResponse() {
  return createMockResponse();
}

describe('Log Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogLevel.mockReturnValue('info');
    mockGetLogBufferEnabled.mockReturnValue(true);
    mockGetComponents.mockReturnValue([]);
  });

  test('should initialize router with nocache and route', () => {
    const router = logRouter.init();
    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should return log level from configuration', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];

    const res = createResponse();
    handler({}, res);

    expect(getLogLevel).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ level: 'info' });
  });
});

describe('Log Entries Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogLevel.mockReturnValue('info');
    mockGetLogBufferEnabled.mockReturnValue(true);
    mockGetComponents.mockReturnValue([]);
  });

  test('should register /entries route', () => {
    logRouter.init();
    expect(mockRouter.get).toHaveBeenCalledWith('/entries', expect.any(Function));
  });

  test('should call getEntries with parsed query params', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const mockEntries = [{ timestamp: 1000, level: 'info', component: 'test', msg: 'hello' }];
    mockGetEntries.mockReturnValue(mockEntries);

    const req = createMockRequest({
      query: { level: 'warn', component: 'api', tail: '50', since: '1000' },
    });
    const res = createResponse();

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: 'warn',
      component: 'api',
      tail: 50,
      since: 1000,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        ...mockEntries[0],
        displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
      }),
    ]);
  });

  test('should normalize level query parameter to lowercase', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({
      query: { level: 'ERROR' },
    });
    const res = createResponse();

    mockGetEntries.mockReturnValue([]);

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: 'error',
      component: undefined,
      tail: undefined,
      since: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('should return 400 when level query parameter is not allowlisted', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({
      query: { level: 'verbose' },
    });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid level query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test.each([
    ['level', 123, 'Invalid level query parameter'],
    ['component', ['docker'], 'Invalid component query parameter'],
    ['tail', ['50'], 'Invalid tail query parameter'],
    ['since', ['1000'], 'Invalid since query parameter'],
  ])('should return 400 when %s query parameter is not a string', (param, value, expectedError) => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({
      query: { [param]: value },
    });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expectedError });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when component query parameter contains unsafe characters', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({
      query: { component: 'docker;rm -rf /' },
    });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid component query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should call getEntries with undefined for missing params', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    mockGetEntries.mockReturnValue([]);

    const req = createMockRequest({ query: {} });
    const res = createResponse();

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: undefined,
      component: undefined,
      tail: undefined,
      since: undefined,
    });
  });

  test('should return 200 with JSON entries', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const mockEntries = [
      { timestamp: 1000, level: 'info', component: 'drydock', msg: 'test1' },
      { timestamp: 2000, level: 'warn', component: 'drydock', msg: 'test2' },
    ];
    mockGetEntries.mockReturnValue(mockEntries);

    const req = createMockRequest({ query: {} });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        ...mockEntries[0],
        displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
      }),
      expect.objectContaining({
        ...mockEntries[1],
        displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
      }),
    ]);
  });

  test('should return 400 when tail query param is non-numeric', () => {
    // Inverted 2026-08-28: this test previously asserted that a non-numeric
    // tail was silently forwarded to getEntries() as NaN with a 200 response.
    // That was a characterization of the bug, not a deliberate contract —
    // `applyTail()` compares `entries.length > NaN`, which is always false, so
    // an unparseable tail silently returned every buffered entry instead of
    // erroring. tail/since now validate the same way level/component already
    // do, matching the sibling audit.ts convention.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { tail: 'abc' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid tail query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when since query param is non-numeric', () => {
    // Inverted 2026-08-28: see the tail test above — `isSince()` compares
    // `entry.timestamp >= NaN`, which is always false, so an unparseable
    // since silently returned zero entries instead of erroring.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { since: 'invalid' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid since query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when tail query parameter has a numeric prefix followed by trailing characters', () => {
    // Number.parseInt('25logs', 10) === 25, which used to slip past the finite check.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { tail: '25logs' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid tail query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when since query parameter has a numeric prefix followed by trailing characters', () => {
    // Number.parseInt('1000ms', 10) === 1000, which used to slip past the finite check.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { since: '1000ms' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid since query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should return 400 when tail query parameter is a digit string that exceeds Number.MAX_SAFE_INTEGER', () => {
    // Passes the /^-?\d+$/ shape check but loses precision as a Number, so
    // Number.isSafeInteger must reject it.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { tail: '99999999999999999999' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid tail query parameter' });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test.each([
    ['level', 'Invalid level query parameter'],
    ['component', 'Invalid component query parameter'],
    ['tail', 'Invalid tail query parameter'],
    ['since', 'Invalid since query parameter'],
  ])('should return 400 when %s query parameter is an empty string', (param, expectedError) => {
    // An empty string means the param was supplied with no value (e.g. `?tail=`),
    // which is distinct from the param being absent altogether. getValidatedLogInteger
    // used to guard with `if (!value)`, and '' is falsy, so it was treated the same as
    // "not supplied" and silently passed through as undefined instead of being rejected.
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { [param]: '' } });
    const res = createResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expectedError });
    expect(mockGetEntries).not.toHaveBeenCalled();
  });

  test('should pass tail=0 through to getEntries', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    mockGetEntries.mockReturnValue([]);

    const req = createMockRequest({ query: { tail: '0' } });
    const res = createResponse();

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: undefined,
      component: undefined,
      tail: 0,
      since: undefined,
    });
  });

  test('should return empty array when log buffer is disabled', () => {
    mockGetLogBufferEnabled.mockReturnValue(false);
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    const req = createMockRequest({ query: { level: 'info', tail: '10' } });
    const res = createResponse();

    handler(req, res);

    expect(mockGetLogBufferEnabled).toHaveBeenCalled();
    expect(mockGetEntries).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('Log Components Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogBufferEnabled.mockReturnValue(true);
    mockGetComponents.mockReturnValue(['api', 'watcher']);
  });

  test('should register /components route', () => {
    logRouter.init();
    expect(mockRouter.get).toHaveBeenCalledWith('/components', expect.any(Function));
  });

  test('should return component names when log buffer is enabled', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/components')[1];

    const res = createResponse();
    handler({}, res);

    expect(mockGetLogBufferEnabled).toHaveBeenCalled();
    expect(mockGetComponents).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(['api', 'watcher']);
  });

  test('should return an empty array when component names are requested with the log buffer disabled', () => {
    mockGetLogBufferEnabled.mockReturnValue(false);
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/components')[1];

    const res = createResponse();
    handler({}, res);

    expect(mockGetComponents).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });
});
