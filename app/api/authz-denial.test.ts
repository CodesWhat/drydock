const { mockRecordAuditEvent, mockRecordAuthzDenied, mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockRecordAuthzDenied: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ warn: mockWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));
vi.mock('../prometheus/auth.js', () => ({ recordAuthzDenied: mockRecordAuthzDenied }));

import {
  _resetAuthzDenialStateForTests,
  API_KEY_ROLE_LABEL,
  recordAuthzDenial,
} from './authz-denial.js';

const person = (role: string, username = 'vera') => ({
  principal: { kind: 'anonymous', username, role },
  method: 'POST',
  baseUrl: '/api/v1/containers',
  route: { path: '/:id/update' },
});

beforeEach(() => {
  vi.clearAllMocks();
  _resetAuthzDenialStateForTests();
});

describe('recordAuthzDenial', () => {
  test('a failing audit write never throws into the request', () => {
    mockRecordAuditEvent.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => recordAuthzDenial(person('viewer') as never, { scope: 'admin' })).not.toThrow();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(mockRecordAuthzDenied).toHaveBeenCalled();
  });

  test('counts the refusal and audits it with actor, role, route and the missed floor', () => {
    recordAuthzDenial(person('viewer') as never, {
      scope: 'containers:update',
      requiredRole: 'operator',
    });

    expect(mockRecordAuthzDenied).toHaveBeenCalledWith('containers:update', 'viewer');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-denied',
      status: 'error',
      containerName: 'authorization',
      details:
        'POST /api/v1/containers/:id/update; scope=containers:update; role=viewer; requiredRole=operator',
      actor: 'vera',
      actorRole: 'viewer',
    });
  });

  test('audits an API key refusal under the api-key role label with no actor role', () => {
    recordAuthzDenial(
      {
        principal: {
          kind: 'api-key',
          username: 'ci',
          keyId: 'k1',
          scopes: ['read'],
          parentKeyId: null,
        },
        method: 'GET',
        baseUrl: '/api/v1/settings',
        route: { path: '/' },
      } as never,
      { scope: 'admin' },
    );

    expect(mockRecordAuthzDenied).toHaveBeenCalledWith('admin', API_KEY_ROLE_LABEL);
    const event = mockRecordAuditEvent.mock.calls[0][0];
    expect(event.actor).toBe('api-key:ci');
    expect(event).not.toHaveProperty('actorRole');
    expect(event.details).toBe('GET /api/v1/settings; scope=admin; role=api-key');
  });

  test('falls back to a placeholder route when the request has none', () => {
    recordAuthzDenial(
      { principal: { kind: 'anonymous', username: 'x', role: 'viewer' } } as never,
      { scope: 'admin' },
    );
    expect(mockRecordAuditEvent.mock.calls[0][0].details).toBe(
      'UNKNOWN ; scope=admin; role=viewer',
    );
  });

  test('audits a denial with no named actor and no role', () => {
    recordAuthzDenial({ method: 'GET' } as never, { scope: 'admin' });
    const event = mockRecordAuditEvent.mock.calls[0][0];
    expect(event).not.toHaveProperty('actor');
    expect(event).not.toHaveProperty('actorRole');
  });

  test('counts every refusal but audits an actor and route once a minute', () => {
    const req = person('viewer') as never;
    recordAuthzDenial(req, { scope: 'admin' }, 1_000);
    recordAuthzDenial(req, { scope: 'admin' }, 30_000);
    recordAuthzDenial(req, { scope: 'admin' }, 60_999);

    expect(mockRecordAuthzDenied).toHaveBeenCalledTimes(3);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1);

    recordAuthzDenial(req, { scope: 'admin' }, 61_000);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(2);
  });

  test('audits a different actor or route separately', () => {
    recordAuthzDenial(person('viewer', 'vera') as never, { scope: 'admin' }, 1_000);
    recordAuthzDenial(person('viewer', 'victor') as never, { scope: 'admin' }, 1_001);
    recordAuthzDenial(
      { ...person('viewer'), route: { path: '/:id/stop' } } as never,
      { scope: 'admin' },
      1_002,
    );
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(3);
  });

  test('stays bounded: expired entries are swept, then the oldest is dropped', () => {
    for (let i = 0; i < 1000; i += 1) {
      recordAuthzDenial(person('viewer', `u${i}`) as never, { scope: 'admin' }, 1_000);
    }
    // Everything is expired by now, so the sweep makes room.
    recordAuthzDenial(person('viewer', 'late') as never, { scope: 'admin' }, 100_000);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1001);

    // Refill inside one window so nothing expires, forcing the oldest out.
    _resetAuthzDenialStateForTests();
    mockRecordAuditEvent.mockClear();
    for (let i = 0; i < 1000; i += 1) {
      recordAuthzDenial(person('viewer', `u${i}`) as never, { scope: 'admin' }, 1_000 + i);
    }
    recordAuthzDenial(person('viewer', 'extra') as never, { scope: 'admin' }, 5_000);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1001);
    // u0 was evicted, so it audits again inside its window; u999 is still tracked.
    recordAuthzDenial(person('viewer', 'u0') as never, { scope: 'admin' }, 5_001);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1002);
    recordAuthzDenial(person('viewer', 'u999') as never, { scope: 'admin' }, 5_002);
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1002);
  });
});
