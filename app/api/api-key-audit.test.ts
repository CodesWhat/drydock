/**
 * Tests for API key audit records.
 *
 * The throttle is the interesting part. An attacker spraying keys must not be
 * able to fill the audit collection, but suppressing rows must not also hide
 * the volume of the attack, so the Prometheus counter and the audit sink are
 * asserted separately on every path.
 */

const { mockRecordAuditEvent, mockRecordAuthApiKeyFailure } = vi.hoisted(() => ({
  mockRecordAuditEvent: vi.fn(),
  mockRecordAuthApiKeyFailure: vi.fn(),
}));

vi.mock('./audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));
vi.mock('../prometheus/auth.js', () => ({
  recordAuthApiKeyFailure: mockRecordAuthApiKeyFailure,
}));

import {
  _apiKeyAuditTrackedSourceCountForTests,
  _resetApiKeyAuditThrottleForTests,
  API_KEY_AUDIT_SENTINEL,
  API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW,
  API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS,
  getAuthFailureSource,
  recordApiKeyAuthFailureAuditEvent,
  recordApiKeyCreatedAuditEvent,
  recordApiKeyRevokedAuditEvent,
  UNPARSEABLE_KEY_SOURCE,
} from './api-key-audit.js';

const KEY_ID = 'a1b2c3d4e5f6';
const OTHER_KEY_ID = 'f6e5d4c3b2a1';
const SECRET = 'A'.repeat(43);
const CREDENTIAL = `ddk_${KEY_ID}_${SECRET}`;
const OTHER_CREDENTIAL = `ddk_${OTHER_KEY_ID}_${SECRET}`;

function detailsOfLastAuditEvent(): string {
  return mockRecordAuditEvent.mock.lastCall?.[0].details as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetApiKeyAuditThrottleForTests();
});

describe('failure source', () => {
  test('a well-formed credential throttles on its own keyId', () => {
    expect(getAuthFailureSource(CREDENTIAL)).toBe(KEY_ID);
  });

  test.each([
    ['a truncated credential', 'ddk_abc'],
    ['a non-hex key id', `ddk_${'z'.repeat(12)}_${SECRET}`],
    ['an unrelated string', 'Bearer nonsense'],
  ])('%s shares the single unparseable bucket', (_label, credential) => {
    // Giving each malformed string its own bucket would defeat the throttle
    // entirely, because the attacker picks the string.
    expect(getAuthFailureSource(credential)).toBe(UNPARSEABLE_KEY_SOURCE);
  });
});

describe('authentication failures', () => {
  test('records an audit row and counts the attempt', () => {
    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL)).toBe(true);

    expect(mockRecordAuthApiKeyFailure).toHaveBeenCalledTimes(1);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'api-key-auth-failed',
      status: 'error',
      containerName: API_KEY_AUDIT_SENTINEL,
      details: `API key authentication failed; keyId=${KEY_ID}`,
    });
  });

  test('never lets the secret reach the audit trail', () => {
    recordApiKeyAuthFailureAuditEvent(CREDENTIAL);

    const serialized = JSON.stringify(mockRecordAuditEvent.mock.calls);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain(KEY_ID);
  });

  test('suppresses a second row for the same key inside the window', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');

    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL, start)).toBe(true);
    expect(
      recordApiKeyAuthFailureAuditEvent(
        CREDENTIAL,
        new Date(start.getTime() + API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS - 1),
      ),
    ).toBe(false);

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1);
  });

  test('still counts every suppressed attempt, so metrics show the real volume', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recordApiKeyAuthFailureAuditEvent(CREDENTIAL, new Date(start.getTime() + attempt));
    }

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordAuthApiKeyFailure).toHaveBeenCalledTimes(50);
  });

  test('records again once the window has passed', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');

    recordApiKeyAuthFailureAuditEvent(CREDENTIAL, start);
    expect(
      recordApiKeyAuthFailureAuditEvent(
        CREDENTIAL,
        new Date(start.getTime() + API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS),
      ),
    ).toBe(true);

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(2);
  });

  test('throttles each key separately, so one noisy key cannot mask another', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');

    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL, start)).toBe(true);
    expect(recordApiKeyAuthFailureAuditEvent(OTHER_CREDENTIAL, start)).toBe(true);

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(2);
  });

  test('a spray of distinct ids is bounded in rows and in tracked sources', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');
    // Every id distinct and every one parseable, which is the shape that used
    // to grow both the map and the audit collection without a ceiling: the
    // per-source throttle never fires, because no source repeats.
    for (let index = 0; index < 1200; index += 1) {
      const keyId = index.toString(16).padStart(12, '0');
      recordApiKeyAuthFailureAuditEvent(`ddk_${keyId}_${SECRET}`, start);
    }

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(
      API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW,
    );
    expect(_apiKeyAuditTrackedSourceCountForTests()).toBe(
      API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW,
    );
    // The volume of the attack is still fully visible, in metrics.
    expect(mockRecordAuthApiKeyFailure).toHaveBeenCalledTimes(1200);
  });

  test('the row budget refills on the next window', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');
    for (let index = 0; index < 1200; index += 1) {
      const keyId = index.toString(16).padStart(12, '0');
      recordApiKeyAuthFailureAuditEvent(`ddk_${keyId}_${SECRET}`, start);
    }

    const nextWindow = new Date(start.getTime() + API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS);
    expect(recordApiKeyAuthFailureAuditEvent(`ddk_${'f'.repeat(12)}_${SECRET}`, nextWindow)).toBe(
      true,
    );
  });

  test('an exhausted budget does not suppress the source it already recorded', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');
    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL, start)).toBe(true);
    for (let index = 0; index < 1200; index += 1) {
      const keyId = index.toString(16).padStart(12, '0');
      recordApiKeyAuthFailureAuditEvent(`ddk_${keyId}_${SECRET}`, start);
    }

    // Still throttled by its own window rather than by the global budget, so
    // the two ceilings stay distinguishable.
    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL, start)).toBe(false);
  });

  test('sweeps only the expired sources once the cap is reached', () => {
    const start = new Date('2026-09-02T12:00:00.000Z');
    const windowMs = API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS;
    let nextId = 0;
    const failAt = (offsetMs: number) => {
      const keyId = nextId.toString(16).padStart(12, '0');
      nextId += 1;
      return recordApiKeyAuthFailureAuditEvent(
        `ddk_${keyId}_${SECRET}`,
        new Date(start.getTime() + offsetMs),
      );
    };

    // Ten windows of fresh ids to reach the 1,000-source cap, because the row
    // budget only refills a window at a time. The last one lands mid-window so
    // it is still inside its own throttle window when the sweep runs.
    for (let windowIndex = 0; windowIndex < 9; windowIndex += 1) {
      for (let index = 0; index < API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW; index += 1) {
        failAt(windowIndex * windowMs);
      }
    }
    for (let index = 0; index < API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW - 1; index += 1) {
      failAt(9 * windowMs);
    }
    failAt(9 * windowMs + 30_000);
    expect(_apiKeyAuditTrackedSourceCountForTests()).toBe(1000);

    // The first row of the next window is what trips the sweep. It drops the
    // nine windows that are past their throttle window and keeps the one that
    // is not, so a live throttle is never reset by the sweep.
    expect(failAt(10 * windowMs)).toBe(true);
    expect(_apiKeyAuditTrackedSourceCountForTests()).toBe(2);
  });

  test('defaults the timestamp to now', () => {
    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL)).toBe(true);
    expect(recordApiKeyAuthFailureAuditEvent(CREDENTIAL)).toBe(false);
  });
});

describe('lifecycle events', () => {
  test('records a creation with the minter and the granted scopes', () => {
    recordApiKeyCreatedAuditEvent(KEY_ID, 'user:scott', ['read', 'containers:watch']);

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'api-key-created',
      status: 'success',
      containerName: API_KEY_AUDIT_SENTINEL,
      details: `Created API key ${KEY_ID}; by=user:scott; scopes=read,containers:watch`,
    });
  });

  test('records a revocation with the cascade count', () => {
    recordApiKeyRevokedAuditEvent(KEY_ID, 'user:scott', [KEY_ID, OTHER_KEY_ID]);

    expect(detailsOfLastAuditEvent()).toBe(`Revoked API key ${KEY_ID}; by=user:scott; cascade=2`);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api-key-revoked', status: 'success' }),
    );
  });

  test('attributes a key-minted key to its parent rather than to a user', () => {
    recordApiKeyCreatedAuditEvent(KEY_ID, `api-key:${OTHER_KEY_ID}`, ['read']);

    expect(detailsOfLastAuditEvent()).toContain(`by=api-key:${OTHER_KEY_ID}`);
  });
});
