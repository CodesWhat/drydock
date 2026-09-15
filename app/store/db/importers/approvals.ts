/**
 * Importer for `approvals` (roadmap 7-STORE slice 6).
 *
 * Flat collection: each stored document is an `ApprovalRecord` with no
 * envelope (`app/store/approval.ts` inserts records directly, the same shape
 * `agent-keys.ts` and `backups.ts` already established as the precedent for
 * a table that maps 1:1 onto a row). A document missing any of the fields a
 * row cannot exist without — the identity quintet (`id`, `containerId`,
 * `containerIdentityKey`, `containerName`, `watcher`), the candidate
 * description (`image`, `fromRef`, `toRef`, `candidateRef`, `updateKind`,
 * `semverDiff`), or the bookkeeping (`schemaVersion`, `createdAt`,
 * `createdAtMs`, `decision`) — is skipped rather than guessed at, since there
 * is no sensible default for "which candidate this decision is about".
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'approvals';
const TARGET_TABLE = 'approvals';

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export const approvalsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      `INSERT INTO approvals
         (id, schema_version, container_id, container_identity_key, container_name, watcher, agent,
          image, from_ref, to_ref, candidate_ref, update_kind, semver_diff, release_notes_url,
          scan_critical, scan_high, scan_medium, scan_low, scan_unknown, scan_at,
          created_at, created_at_ms, decision, decided_at, decided_by, decision_note,
          deferred_until, operation_id, outcome, resolved_at, resolution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (
        typeof doc.id !== 'string' ||
        typeof doc.containerId !== 'string' ||
        typeof doc.containerIdentityKey !== 'string' ||
        typeof doc.containerName !== 'string' ||
        typeof doc.watcher !== 'string' ||
        typeof doc.image !== 'string' ||
        typeof doc.fromRef !== 'string' ||
        typeof doc.toRef !== 'string' ||
        typeof doc.candidateRef !== 'string' ||
        typeof doc.updateKind !== 'string' ||
        typeof doc.semverDiff !== 'string' ||
        typeof doc.schemaVersion !== 'number' ||
        typeof doc.createdAt !== 'string' ||
        typeof doc.createdAtMs !== 'number' ||
        typeof doc.decision !== 'string'
      ) {
        continue;
      }

      insert.run(
        doc.id,
        doc.schemaVersion,
        doc.containerId,
        doc.containerIdentityKey,
        doc.containerName,
        doc.watcher,
        optionalString(doc.agent),
        doc.image,
        doc.fromRef,
        doc.toRef,
        doc.candidateRef,
        doc.updateKind,
        doc.semverDiff,
        optionalString(doc.releaseNotesUrl),
        optionalNumber(doc.scanCritical),
        optionalNumber(doc.scanHigh),
        optionalNumber(doc.scanMedium),
        optionalNumber(doc.scanLow),
        optionalNumber(doc.scanUnknown),
        optionalString(doc.scanAt),
        doc.createdAt,
        doc.createdAtMs,
        doc.decision,
        optionalString(doc.decidedAt),
        optionalString(doc.decidedBy),
        optionalString(doc.decisionNote),
        optionalString(doc.deferredUntil),
        optionalString(doc.operationId),
        optionalString(doc.outcome),
        optionalString(doc.resolvedAt),
        optionalString(doc.resolution),
      );
      rows += 1;
    }
    return rows;
  },
};
