import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { containersImporter } from './containers.js';
import { COLLECTION_IMPORTERS } from './index.js';

function snapshotOf(containerRecords: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [{ name: 'containers', data: containerRecords.map((data) => ({ data })) }],
    }),
    'dd.json',
  );
}

describe('store/db/importers/containers', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(containerRecords: Record<string, unknown>[]): number {
    return containersImporter.importInto({
      db,
      snapshot: snapshotOf(containerRecords),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(containersImporter);
    expect(containersImporter.collection).toBe('containers');
    expect(containersImporter.table).toBe('containers');
  });

  test('imports a valid legacy container document into the containers table', () => {
    expect(run([createContainerFixture({ id: 'container-1' })])).toBe(1);

    expect(db.prepare('SELECT id, name FROM containers WHERE id = ?').get('container-1')).toEqual({
      id: 'container-1',
      name: 'test',
    });
  });

  test('carries the dependency fields of a 1.7 container document', () => {
    expect(
      run([
        createContainerFixture({
          id: 'container-with-dependencies',
          dependsOn: ['db', 'cache'],
          dependsOnSource: 'compose',
          dependsOnAction: 'restart',
        }),
      ]),
    ).toBe(1);

    const row = db
      .prepare('SELECT dependency_config FROM containers WHERE id = ?')
      .get('container-with-dependencies');
    expect(JSON.parse(String(row?.dependency_config))).toEqual({
      dependsOn: ['db', 'cache'],
      dependsOnSource: 'compose',
      dependsOnAction: 'restart',
    });
  });

  test('skips a document that fails container validation', () => {
    expect(run([{ id: 'missing-required-fields' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM containers').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
