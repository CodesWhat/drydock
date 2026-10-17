/**
 * Importer for `backups` (roadmap 7-STORE slice 5; identity backfill added
 * in slice 10).
 *
 * Enveloped collection: each stored document is `{ data: ImageBackup }`. A
 * document missing any of the fields a row cannot exist without (`id`,
 * `containerName`, `imageName`, `imageTag`, `triggerName`, `timestamp`) is
 * skipped rather than guessed at. `containerIdentityKey` carries across when
 * present.
 *
 * A legacy record that never recorded an identity is backfilled from the
 * containers this same import already wrote: if exactly one imported
 * container carries the backup's `containerName`, that container's
 * `identity_key` is what the backup is stamped with, so a rename made after
 * the upgrade still finds it (`getBackupsForContainer`, roadmap 7-STORE
 * slice 10, spec 2.3). A name with zero or more than one match is genuinely
 * ambiguous — the same case the old `includeLegacy` heuristic refused to
 * resolve — and the row imports with a NULL identity instead of a guess.
 * This importer must run after `containersImporter` (see
 * `./index.js`) so that lookup sees the imported rows.
 */
import logger from '../../../log/index.js';
import type { Database } from '../driver.js';
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'backups';
const TARGET_TABLE = 'backups';

const log = logger.child({ component: 'store.db.backups' });

/**
 * Resolve the durable identity key for a legacy backup's container name,
 * when the imported `containers` table carries exactly one distinct
 * identity for that name. Returns `undefined` for zero or multiple matches.
 */
function resolveIdentityKeyByName(db: Database, containerName: string): string | undefined {
  const candidates = db
    .prepare('SELECT DISTINCT identity_key FROM containers WHERE name = ?')
    .all(containerName) as { identity_key: string }[];
  return candidates.length === 1 ? candidates[0].identity_key : undefined;
}

export const backupsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      `INSERT INTO backups
         (id, container_identity_key, container_name, container_id, image_name, image_tag, image_digest, timestamp, trigger_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let rows = 0;
    let backfilled = 0;
    let unresolved = 0;
    for (const record of snapshot.records(LEGACY_COLLECTION)) {
      if (
        typeof record.id !== 'string' ||
        typeof record.containerName !== 'string' ||
        typeof record.imageName !== 'string' ||
        typeof record.imageTag !== 'string' ||
        typeof record.triggerName !== 'string' ||
        typeof record.timestamp !== 'string'
      ) {
        continue;
      }
      let identityKey =
        typeof record.containerIdentityKey === 'string' ? record.containerIdentityKey : undefined;
      if (!identityKey) {
        identityKey = resolveIdentityKeyByName(db, record.containerName);
        if (identityKey) {
          backfilled += 1;
        } else {
          unresolved += 1;
        }
      }
      insert.run(
        record.id,
        identityKey ?? null,
        record.containerName,
        typeof record.containerId === 'string' ? record.containerId : null,
        record.imageName,
        record.imageTag,
        typeof record.imageDigest === 'string' ? record.imageDigest : null,
        record.timestamp,
        record.triggerName,
      );
      rows += 1;
    }
    if (backfilled > 0) {
      log.info(`Backfilled the container identity of ${backfilled} legacy backup row(s) by name`);
    }
    if (unresolved > 0) {
      log.warn(
        `${unresolved} legacy backup row(s) left without a container identity: the container name matched none or more than one imported container`,
      );
    }
    return rows;
  },
};
