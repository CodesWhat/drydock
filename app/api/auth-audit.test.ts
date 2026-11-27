import { describe, expect, test, vi } from 'vitest';
import { sanitizeLogParam } from '../log/sanitize.js';

const { mockRecordAuditEvent } = vi.hoisted(() => ({
  mockRecordAuditEvent: vi.fn(),
}));

vi.mock('./audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));

import { recordLoginAuditEvent } from './auth-audit.js';

describe('recordLoginAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sanitizes explicit login identities before including them in audit details', () => {
    const req = { principal: { kind: 'basic', username: 'fallback-user' } } as any;
    const details = 'Authentication failed (invalid credentials)';
    const loginIdentity = 'bad-user\n\x1B[31m';

    recordLoginAuditEvent(req, 'error', details, loginIdentity);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=${sanitizeLogParam(loginIdentity)}`,
    });
  });

  test('falls back to the principal username when loginIdentity is not provided', () => {
    const req = { principal: { kind: 'basic', username: 'alice' } } as any;
    const details = 'Login success';

    recordLoginAuditEvent(req, 'success', details);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'success',
      containerName: 'authentication',
      details: `${details}; user=${sanitizeLogParam('alice')}`,
    });
  });

  test('falls back to the principal username when loginIdentity is empty string', () => {
    const req = { principal: { kind: 'basic', username: 'bob' } } as any;
    const details = 'Login attempt';

    recordLoginAuditEvent(req, 'error', details, '');

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=${sanitizeLogParam('bob')}`,
    });
  });

  test('falls back to the principal username when loginIdentity is whitespace-only', () => {
    const req = { principal: { kind: 'basic', username: 'carol' } } as any;
    const details = 'Login attempt';

    recordLoginAuditEvent(req, 'error', details, '   ');

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=${sanitizeLogParam('carol')}`,
    });
  });

  test('falls back to "unknown" when no principal is present and loginIdentity is not given', () => {
    const req = {} as any;
    const details = 'Login attempt with no user context';

    recordLoginAuditEvent(req, 'error', details);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=unknown`,
    });
  });

  test('falls back to "unknown" when the principal is anonymous', () => {
    const req = { principal: { kind: 'anonymous', username: 'anonymous' } } as any;
    const details = 'Login attempt';

    recordLoginAuditEvent(req, 'error', details);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=unknown`,
    });
  });

  test('falls back to "unknown" when the principal username is a number', () => {
    const req = { principal: { kind: 'basic', username: 42 as unknown as string } } as any;
    const details = 'Login attempt';

    recordLoginAuditEvent(req, 'error', details);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'error',
      containerName: 'authentication',
      details: `${details}; user=unknown`,
    });
  });

  test('uses loginIdentity over the principal username when loginIdentity is a non-empty string', () => {
    const req = { principal: { kind: 'basic', username: 'fallback' } } as any;
    const details = 'Auth success';

    recordLoginAuditEvent(req, 'success', details, 'dave');

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'auth-login',
      status: 'success',
      containerName: 'authentication',
      details: `${details}; user=${sanitizeLogParam('dave')}`,
    });
  });

  test('audit details string contains the semicolon separator and user= label', () => {
    const req = { principal: { kind: 'basic', username: 'eve' } } as any;
    const details = 'Some event';

    recordLoginAuditEvent(req, 'success', details);

    const call = mockRecordAuditEvent.mock.calls[0][0];
    expect(call.details).toContain('; user=');
    expect(call.details).toContain(details);
  });
});
