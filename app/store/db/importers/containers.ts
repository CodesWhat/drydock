/**
 * Importer for `containers` (roadmap 7-STORE slice 8).
 *
 * Enveloped collection: each stored document is `{ data: Container }`, the
 * same shape `app/store/container.ts`'s `insertContainer`/`updateContainer`
 * already write. Unlike every other importer in this registry, this one
 * reuses that store module's own row-building helpers
 * (`buildImportedContainerRow`/`insertImportedContainerRow`) instead of
 * hand-writing a column list a second time: the containers table has by far
 * the largest column count of any table in the schema, most of it grouped
 * JSON rather than flat scalars, and every one of those columns is derived
 * from `validateContainer()` exactly the way a fresh `insertContainer()`
 * would derive it. Duplicating that mapping here would only give it a chance
 * to drift from the one the read path relies on.
 *
 * A document that fails `validateContainer()` (missing a field the current
 * schema requires — the shape of a container hand-authored for an older
 * test fixture, or a genuinely corrupt row) is skipped rather than guessed
 * at, the same as every other importer's convention for an unusable
 * document.
 */
import { buildImportedContainerRow, insertImportedContainerRow } from '../../container.js';
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'containers';
const TARGET_TABLE = 'containers';

export const containersImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    let rows = 0;
    for (const record of snapshot.records(LEGACY_COLLECTION)) {
      const row = buildImportedContainerRow(record);
      if (!row) {
        continue;
      }
      insertImportedContainerRow(db, row);
      rows += 1;
    }
    return rows;
  },
};
