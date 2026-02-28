import { createMockResponse } from '../test/helpers.js';

const {
  mockRouter,
  mockGetNotificationRules,
  mockUpdateNotificationRule,
  mockGetRegistryState,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), patch: vi.fn(), put: vi.fn() },
  mockGetNotificationRules: vi.fn(() => [
    {
      id: 'update-available',
      name: 'Update Available',
      enabled: true,
      triggers: ['slack.ops', 'docker.update'],
      description: 'When a container has a new version',
    },
  ]),
  mockUpdateNotificationRule: vi.fn((id, update) => ({
    id,
    name: 'Update Available',
    enabled: update.enabled ?? true,
    triggers: update.triggers ?? [],
    description: 'When a container has a new version',
  })),
  mockGetRegistryState: vi.fn(() => ({
    trigger: {
      'slack.ops': { type: 'slack', name: 'ops' },
      'smtp.ops': { type: 'smtp', name: 'ops' },
      'docker.update': { type: 'docker', name: 'update' },
    },
  })),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/notification', () => ({
  getNotificationRules: mockGetNotificationRules,
  updateNotificationRule: mockUpdateNotificationRule,
}));

vi.mock('../registry', () => ({
  getState: mockGetRegistryState,
}));

import * as notificationRouter from './notification.js';

describe('Notification Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and routes', () => {
    const router = notificationRouter.init();

    expect(router.use).toHaveBeenCalledWith('nocache-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.patch).toHaveBeenCalledWith('/:id', expect.any(Function));
    expect(router.get).toHaveBeenCalledTimes(1);
    expect(router.patch).toHaveBeenCalledTimes(1);
    expect(router.put).not.toHaveBeenCalled();
  });

  test('should return all notification rules', () => {
    notificationRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({}, res);

    expect(mockGetNotificationRules).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      {
        id: 'update-available',
        name: 'Update Available',
        enabled: true,
        triggers: ['slack.ops'],
        description: 'When a container has a new version',
      },
    ]);
  });

  test('should handle missing trigger registry state when listing rules', () => {
    mockGetRegistryState.mockReturnValueOnce({});
    notificationRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'update-available',
        triggers: [],
      }),
    ]);
  });

  test('should preserve falsy rules when store returns sparse entries', () => {
    mockGetNotificationRules.mockReturnValueOnce([undefined]);
    notificationRouter.init();
    const handler = mockRouter.get.mock.calls.find((call) => call[0] === '/')[1];
    const res = createMockResponse();

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([undefined]);
  });

  test('should update a notification rule when payload is valid', () => {
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'update-available' },
        body: {
          enabled: false,
          triggers: ['smtp.ops', 'slack.ops'],
        },
      },
      res,
    );

    expect(mockUpdateNotificationRule).toHaveBeenCalledWith('update-available', {
      enabled: false,
      triggers: ['slack.ops', 'smtp.ops'],
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: 'update-available',
      name: 'Update Available',
      enabled: false,
      triggers: ['slack.ops', 'smtp.ops'],
      description: 'When a container has a new version',
    });
  });

  test('should reject unsupported trigger ids when updating a notification rule', () => {
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'update-available' },
        body: {
          triggers: ['docker.update'],
        },
      },
      res,
    );

    expect(mockUpdateNotificationRule).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unsupported notification triggers: docker.update',
    });
  });

  test('should reject invalid notification update payload', () => {
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'update-available' },
        body: { enabled: 'yes' },
      },
      res,
    );

    expect(mockUpdateNotificationRule).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.any(String),
    });
  });

  test('should reject empty notification update payload when request body is undefined', () => {
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'update-available' },
      },
      res,
    );

    expect(mockUpdateNotificationRule).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.any(String),
    });
  });

  test('should return 404 when updating unknown rule id', () => {
    mockUpdateNotificationRule.mockReturnValueOnce(undefined);
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'missing' },
        body: { enabled: false },
      },
      res,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(404);
  });

  test('should return 400 when store update throws', () => {
    mockUpdateNotificationRule.mockImplementationOnce(() => {
      throw new Error('update failure');
    });
    notificationRouter.init();
    const handler = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id')[1];
    const res = createMockResponse();

    handler(
      {
        params: { id: 'update-available' },
        body: { enabled: true },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'update failure',
    });
  });
});
