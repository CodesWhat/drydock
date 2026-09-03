/**
 * The approval queue's one outbound event.
 *
 * Both writers of the ledger — the reconciler on the watch cycle and the decision API —
 * announce through here, so the badge count a client patches in is always read after the
 * store write that caused it and always by the same code. A second announce site would be
 * a second chance to send a stale count, or to send a payload with a container on it.
 *
 * The payload is five scalars. DR-4 is the standing lesson: the SSE ring buffer caps a
 * client at 256 KB of pending bytes, and a lifecycle payload carrying a container snapshot
 * (per-CVE arrays, SBOM, signatures) disconnects every listener. Everything richer is
 * fetched from `/api/v1/approvals`.
 */
import { type ApprovalEventKind, emitApprovalEvent } from '../event/index.js';
import logger from '../log/index.js';
import type { ApprovalRecord } from '../model/approval.js';
import { countApprovals } from '../store/approval.js';
import { getErrorMessage } from '../util/error.js';

const log = logger.child({ component: 'approvals' });

/**
 * Tell the SSE layer a row entered the queue, was decided, or left it. Dispatched rather
 * than awaited: the store write is what matters and it has already happened, the
 * container-removed listener is on the synchronous legacy channel and cannot await
 * anything, and a subscriber's failure must not become the watch cycle's or the
 * request's.
 * @param kind
 * @param record
 */
export function announceApprovalEvent(kind: ApprovalEventKind, record: ApprovalRecord): void {
  void emitApprovalEvent({
    kind,
    id: record.id,
    containerId: record.containerId,
    containerName: record.containerName,
    decision: record.decision,
    // Read after the write, so the badge count a client patches in is the count the list
    // endpoint would return for the same instant.
    pendingCount: countApprovals().pending,
  }).catch((error) => {
    log.warn(`Approval event dispatch failed: ${getErrorMessage(error)}`);
  });
}
