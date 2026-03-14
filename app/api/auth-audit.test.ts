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
  test('sanitizes explicit login identities before including them in audit details', () => {
    const req = { user: { username: 'fallback-user' } } as any;
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
});
