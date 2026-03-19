import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

const mockCollectDebugDump = vi.fn();
const mockSerializeDebugDump = vi.fn();
const mockGetDebugDumpFilename = vi.fn(() => 'drydock-debug-dump-2026-03-18.json');

vi.mock('../debug/dump.js', () => ({
  collectDebugDump: (...args: any[]) => mockCollectDebugDump(...args),
  serializeDebugDump: (...args: any[]) => mockSerializeDebugDump(...args),
  getDebugDumpFilename: (...args: any[]) => mockGetDebugDumpFilename(...args),
}));

import * as debugRouter from './debug.js';

function createResponse() {
  return createMockResponse();
}

describe('Debug Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers nocache middleware and /dump route', () => {
    const router = debugRouter.init();
    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/dump', expect.any(Function));
  });

  test('returns an attached debug dump payload', async () => {
    const dumpPayload = { metadata: { timestamp: '2026-03-18T00:00:00.000Z' } };
    mockCollectDebugDump.mockResolvedValue(dumpPayload);
    mockSerializeDebugDump.mockReturnValue('{"metadata":{"timestamp":"2026-03-18T00:00:00.000Z"}}');

    debugRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/dump')?.[1];

    const res = createResponse();
    await handler({ query: {} }, res);

    expect(mockCollectDebugDump).toHaveBeenCalledWith({ recentMinutes: 30 });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="drydock-debug-dump-'),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('{"metadata":{"timestamp":"2026-03-18T00:00:00.000Z"}}');
  });

  test('uses minutes query parameter when provided', async () => {
    mockCollectDebugDump.mockResolvedValue({});
    mockSerializeDebugDump.mockReturnValue('{}');

    debugRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/dump')?.[1];

    const res = createResponse();
    await handler({ query: { minutes: '45' } }, res);

    expect(mockCollectDebugDump).toHaveBeenCalledWith({ recentMinutes: 45 });
  });

  test('uses the first array value for the minutes query parameter', async () => {
    mockCollectDebugDump.mockResolvedValue({});
    mockSerializeDebugDump.mockReturnValue('{}');

    debugRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/dump')?.[1];

    const res = createResponse();
    await handler({ query: { minutes: ['abc'] } }, res);

    expect(mockCollectDebugDump).toHaveBeenCalledWith({ recentMinutes: 30 });
  });

  test('falls back to the default minutes value when the query parses to zero', async () => {
    mockCollectDebugDump.mockResolvedValue({});
    mockSerializeDebugDump.mockReturnValue('{}');

    debugRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/dump')?.[1];

    const res = createResponse();
    await handler({ query: { minutes: '0' } }, res);

    expect(mockCollectDebugDump).toHaveBeenCalledWith({ recentMinutes: 30 });
  });

  test('returns an error response when the debug dump cannot be generated', async () => {
    mockCollectDebugDump.mockRejectedValue(new Error('boom'));

    debugRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/dump')?.[1];

    const res = createResponse();
    await handler({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to generate debug dump',
    });
  });
});
