/**
 * The start-up half of an offline two-factor command: each marker it left
 * becomes one audit entry, exactly once, on the real audit and TOTP stores.
 */
const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() },
}));

vi.mock('../log/index.js', () => {
  mockLog.child.mockReturnValue(mockLog);
  return { default: mockLog };
});

import * as auditStore from '../store/audit.js';
import type { Database } from '../store/db/driver.js';
import * as totpStore from '../store/totp.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { recordOfflineTotpOperations } from './totp-offline-audit.js';

const REMOVED_AT = '2026-10-05T08:00:00.000Z';
const REBOUND_AT = '2026-10-05T09:00:00.000Z';

let db: Database;

const breakGlassEntries = () => auditStore.getAuditEntries({ action: 'totp-break-glass' }).entries;

beforeEach(() => {
  vi.clearAllMocks();
  mockLog.child.mockReturnValue(mockLog);
  db = createMigratedMemoryDatabase();
  auditStore.createCollections(db);
  totpStore.createCollections(db);
});

afterEach(() => {
  db.close();
});

test('does nothing, and says nothing, when no offline command has run', () => {
  recordOfflineTotpOperations();

  expect(breakGlassEntries()).toEqual([]);
  expect(mockLog.warn).not.toHaveBeenCalled();
});

test('writes one audit entry per operation, with ids and times only, and warns in the log', () => {
  totpStore.recordOfflineOperation({
    operation: 'remove',
    subjectId: 'subject-a',
    factorId: 'factor-a',
    at: REMOVED_AT,
  });
  totpStore.recordOfflineOperation({
    operation: 'rebind',
    subjectId: 'subject-old',
    factorId: 'factor-b',
    targetSubjectId: 'subject-new',
    at: REBOUND_AT,
  });

  recordOfflineTotpOperations();

  const entries = breakGlassEntries();
  expect(entries).toHaveLength(2);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: 'totp-break-glass',
        status: 'success',
        containerName: 'authentication',
        details: `operation=remove subject=subject-a factor=factor-a at=${REMOVED_AT}`,
      }),
      expect.objectContaining({
        action: 'totp-break-glass',
        status: 'success',
        containerName: 'authentication',
        details: `operation=rebind subject=subject-old factor=factor-b to=subject-new at=${REBOUND_AT}`,
      }),
    ]),
  );
  expect(mockLog.warn).toHaveBeenCalledWith(
    `An offline two-factor command changed the store while Drydock was stopped (operation=remove subject=subject-a factor=factor-a at=${REMOVED_AT})`,
  );
  expect(mockLog.warn).toHaveBeenCalledTimes(2);
});

test('records each operation once: a second start finds nothing left', () => {
  totpStore.recordOfflineOperation({
    operation: 'remove',
    subjectId: 'subject-a',
    factorId: 'factor-a',
    at: REMOVED_AT,
  });

  recordOfflineTotpOperations();
  recordOfflineTotpOperations();

  expect(breakGlassEntries()).toHaveLength(1);
  expect(totpStore.countPendingOfflineOperations()).toBe(0);
});

test('keeps the markers for the next start when the audit entry cannot be written', () => {
  totpStore.recordOfflineOperation({
    operation: 'remove',
    subjectId: 'subject-a',
    factorId: 'factor-a',
    at: REMOVED_AT,
  });
  db.exec('ALTER TABLE audit RENAME TO audit_away');

  expect(() => recordOfflineTotpOperations()).not.toThrow();

  expect(totpStore.countPendingOfflineOperations()).toBe(1);
  expect(mockLog.warn).toHaveBeenCalledWith(
    expect.stringContaining('Unable to record offline two-factor operations'),
  );
  db.exec('ALTER TABLE audit_away RENAME TO audit');
  recordOfflineTotpOperations();
  expect(breakGlassEntries()).toHaveLength(1);
});

test('says how many markers it could not read', () => {
  db.prepare('INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)').run(
    'totp-offline-operation:tampered',
    'not json',
    REMOVED_AT,
  );

  recordOfflineTotpOperations();

  expect(breakGlassEntries()).toEqual([]);
  expect(mockLog.warn).toHaveBeenCalledWith(
    'Discarded 1 unreadable offline two-factor marker(s) from the store',
  );
});
