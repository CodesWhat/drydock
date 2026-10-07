/**
 * The start-up half of the offline two-factor commands (spec 11.1.2 decision
 * 5). `remove` and `rebind` run while Drydock is stopped, so they cannot write
 * to the audit trail of a running instance. Each leaves a marker in the store
 * instead, and the next start turns every marker into a `totp-break-glass`
 * entry here. Ids and times only, as with every other two-factor entry.
 */

import log from '../log/index.js';
import { consumeOfflineOperations, type TotpOfflineOperation } from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import { recordAuditEvent } from './audit-events.js';

function describeOperation(operation: TotpOfflineOperation): string {
  const target = operation.targetSubjectId === undefined ? '' : ` to=${operation.targetSubjectId}`;
  return `operation=${operation.operation} subject=${operation.subjectId} factor=${operation.factorId}${target} at=${operation.at}`;
}

/**
 * Record every offline operation since the last start. A marker is deleted in
 * the same transaction that writes its audit entry, so a fault keeps it for
 * the next start rather than losing it, and never stops this one.
 */
export function recordOfflineTotpOperations(): void {
  try {
    const { discarded } = consumeOfflineOperations((operation) => {
      const details = describeOperation(operation);
      recordAuditEvent({
        action: 'totp-break-glass',
        status: 'success',
        containerName: 'authentication',
        details,
      });
      log.warn(
        `An offline two-factor command changed the store while Drydock was stopped (${details})`,
      );
    });
    if (discarded > 0) {
      log.warn(`Discarded ${discarded} unreadable offline two-factor marker(s) from the store`);
    }
  } catch (error: unknown) {
    log.warn(`Unable to record offline two-factor operations (${getErrorMessage(error)})`);
  }
}
