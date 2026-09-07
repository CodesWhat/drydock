/**
 * Importer for `backups` (roadmap 7-STORE slice 5).
 *
 * Enveloped collection: each stored document is `{ data: ImageBackup }`. A
 * document missing any of the fields a row cannot exist without (`id`,
 * `containerName`, `imageName`, `imageTag`, `triggerName`, `timestamp`) is
 * skipped rather than guessed at. `containerIdentityKey` carries across when
 * present; a legacy record that never recorded one imports with a NULL
 * `container_identity_key`, exactly as `insertBackup` already treats a
 * missing identity today.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'backups';
const TARGET_TABLE = 'backups';

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
      insert.run(
        record.id,
        typeof record.containerIdentityKey === 'string' ? record.containerIdentityKey : null,
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
    return rows;
  },
};
