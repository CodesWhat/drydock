/**
 * Importer for `update_operations` (roadmap 7-STORE slice 10).
 *
 * Enveloped collection: each stored document is `{ data: UpdateOperation }`,
 * the same shape `app/store/update-operation.ts`'s `insertOperation`/
 * `updateOperation` already write. As with the containers importer (slice
 * 8), this reuses that store module's own row-building helpers
 * (`buildImportedUpdateOperationRow`/`insertImportedUpdateOperationRow`)
 * instead of hand-writing a second 35-column mapping here, so an imported
 * row's `container_identity_key` is derived through exactly the same
 * `deriveOperationIdentityKey` logic a fresh insert uses today.
 *
 * A document missing one of the columns the schema requires NOT NULL (`id`,
 * `containerName`, `status`, `phase`, `createdAt`, `updatedAt`) is skipped
 * rather than guessed at, the same as every other importer's convention for
 * an unusable document.
 */
import {
  buildImportedUpdateOperationRow,
  insertImportedUpdateOperationRow,
} from '../../update-operation.js';
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'updateOperations';
const TARGET_TABLE = 'update_operations';

export const updateOperationsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    let rows = 0;
    for (const record of snapshot.records(LEGACY_COLLECTION)) {
      const row = buildImportedUpdateOperationRow(record);
      if (!row) {
        continue;
      }
      insertImportedUpdateOperationRow(db, row);
      rows += 1;
    }
    return rows;
  },
};
