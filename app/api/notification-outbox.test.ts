import { createMockResponse } from '../test/helpers.js';

const {
  mockRouter,
  mockFindOutboxEntriesByStatus,
  mockGetOutboxEntry,
  mockRequeueDeadLetterEntry,
  mockRemoveOutboxEntry,
} = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  mockFindOutboxEntriesByStatus: vi.fn((status: string) => {
    if (status === 'dead-letter') {
      return [
        {
          id: 'entry-1',
          eventName: 'update-available',
          payload: {},
          triggerId: 'slack.ops',
          attempts: 5,
          maxAttempts: 5,
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          status: 'dead-letter',
          createdAt: '2026-01-01T00:00:00.000Z',
          failedAt: '2026-01-01T01:00:00.000Z',
        },
      ];
    }
    if (status === 'pending') {
      return [
        {
          id: 'entry-2',
          eventName: 'update-available',
          payload: {},
          triggerId: 'slack.ops',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ];
    }
    return [];
  }),
  mockGetOutboxEntry: vi.fn((id: string) => {
    if (id === 'entry-1') {
      return {
        id: 'entry-1',
        eventName: 'update-available',
        payload: {},
        triggerId: 'slack.ops',
        attempts: 5,
        maxAttempts: 5,
        nextAttemptAt: '2026-01-01T00:00:00.000Z',
        status: 'dead-letter',
        createdAt: '2026-01-01T00:00:00.000Z',
        failedAt: '2026-01-01T01:00:00.000Z',
      };
    }
    return undefined;
  }),
  mockRequeueDeadLetterEntry: vi.fn((id: string) => {
    if (id === 'entry-1') {
      return {
        id: 'entry-1',
        eventName: 'update-available',
        payload: {},
        triggerId: 'slack.ops',
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: '2026-01-01T00:00:00.000Z',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    }
    return undefined;
  }),
  mockRemoveOutboxEntry: vi.fn((id: string) => id === 'entry-1'),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/notification-outbox', () => ({
  findOutboxEntriesByStatus: mockFindOutboxEntriesByStatus,
  getOutboxEntry: mockGetOutboxEntry,
  requeueDeadLetterEntry: mockRequeueDeadLetterEntry,
  removeOutboxEntry: mockRemoveOutboxEntry,
}));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import * as outboxRouter from './notification-outbox.js';

describe('Notification Outbox Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and routes', () => {
    const router = outboxRouter.init();

    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.post).toHaveBeenCalledWith('/:id/retry', expect.any(Function));
    expect(router.delete).toHaveBeenCalledWith('/:id', expect.any(Function));
  });

  describe('GET /', () => {
    test('returns dead-letter entries by default (no status param)', () => {
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: {} }, res);

      expect(mockFindOutboxEntriesByStatus).toHaveBeenCalledWith('dead-letter');
      expect(res.status).toHaveBeenCalledWith(200);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('dead-letter');
      expect(body.total).toBe(1);
      expect(body.counts).toEqual({ pending: 1, delivered: 0, deadLetter: 1 });
    });

    test('returns pending entries when status=pending', () => {
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: { status: 'pending' } }, res);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('pending');
      expect(body.total).toBe(1);
    });

    test('returns delivered entries when status=delivered', () => {
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: { status: 'delivered' } }, res);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    test('returns dead-letter entries when status=dead-letter', () => {
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: { status: 'dead-letter' } }, res);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.data[0].status).toBe('dead-letter');
    });

    test('returns 400 for invalid status param', () => {
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: { status: 'bad-status' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid status: bad-status. Must be one of: pending, delivered, dead-letter',
      });
    });

    test('returns 500 when store throws', () => {
      mockFindOutboxEntriesByStatus.mockImplementationOnce(() => {
        throw new Error('store failure');
      });
      outboxRouter.init();
      const handler = mockRouter.get.mock.calls.find((c) => c[0] === '/')[1];
      const res = createMockResponse();

      handler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('POST /:id/retry', () => {
    test('requeues a dead-letter entry and returns 200 with the updated entry', () => {
      outboxRouter.init();
      const handler = mockRouter.post.mock.calls.find((c) => c[0] === '/:id/retry')[1];
      const res = createMockResponse();

      handler({ params: { id: 'entry-1' } }, res);

      expect(mockRequeueDeadLetterEntry).toHaveBeenCalledWith('entry-1');
      expect(res.status).toHaveBeenCalledWith(200);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.id).toBe('entry-1');
      expect(body.status).toBe('pending');
    });

    test('returns 404 when entry not found or not dead-letter', () => {
      outboxRouter.init();
      const handler = mockRouter.post.mock.calls.find((c) => c[0] === '/:id/retry')[1];
      const res = createMockResponse();

      handler({ params: { id: 'missing' } }, res);

      expect(mockRequeueDeadLetterEntry).toHaveBeenCalledWith('missing');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Outbox entry not found or not in dead-letter status',
      });
    });

    test('returns 500 when store throws', () => {
      mockRequeueDeadLetterEntry.mockImplementationOnce(() => {
        throw new Error('retry failure');
      });
      outboxRouter.init();
      const handler = mockRouter.post.mock.calls.find((c) => c[0] === '/:id/retry')[1];
      const res = createMockResponse();

      handler({ params: { id: 'entry-1' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('DELETE /:id', () => {
    test('removes an entry and returns 204', () => {
      outboxRouter.init();
      const handler = mockRouter.delete.mock.calls.find((c) => c[0] === '/:id')[1];
      const res = createMockResponse();

      handler({ params: { id: 'entry-1' } }, res);

      expect(mockGetOutboxEntry).toHaveBeenCalledWith('entry-1');
      expect(mockRemoveOutboxEntry).toHaveBeenCalledWith('entry-1');
      expect(res.status).toHaveBeenCalledWith(204);
    });

    test('returns 404 when entry does not exist', () => {
      outboxRouter.init();
      const handler = mockRouter.delete.mock.calls.find((c) => c[0] === '/:id')[1];
      const res = createMockResponse();

      handler({ params: { id: 'missing' } }, res);

      expect(mockGetOutboxEntry).toHaveBeenCalledWith('missing');
      expect(mockRemoveOutboxEntry).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Outbox entry not found' });
    });

    test('returns 500 when store throws', () => {
      mockGetOutboxEntry.mockImplementationOnce(() => {
        throw new Error('lookup failure');
      });
      outboxRouter.init();
      const handler = mockRouter.delete.mock.calls.find((c) => c[0] === '/:id')[1];
      const res = createMockResponse();

      handler({ params: { id: 'entry-1' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });
});
