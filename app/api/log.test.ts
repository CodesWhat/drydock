import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetEntries, mockGetLogLevel, mockGetLogBufferEnabled } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
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
    expect(res.json).toHaveBeenCalledWith(mockEntries);
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
    expect(res.json).toHaveBeenCalledWith(mockEntries);
  });

  test('should pass NaN tail when query param is non-numeric', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    mockGetEntries.mockReturnValue([]);

    const req = createMockRequest({ query: { tail: 'abc' } });
    const res = createResponse();

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: undefined,
      component: undefined,
      tail: NaN,
      since: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('should pass NaN since when query param is non-numeric', () => {
    logRouter.init();
    const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/entries')[1];

    mockGetEntries.mockReturnValue([]);

    const req = createMockRequest({ query: { since: 'invalid' } });
    const res = createResponse();

    handler(req, res);

    expect(mockGetEntries).toHaveBeenCalledWith({
      level: undefined,
      component: undefined,
      tail: undefined,
      since: NaN,
    });
    expect(res.status).toHaveBeenCalledWith(200);
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
