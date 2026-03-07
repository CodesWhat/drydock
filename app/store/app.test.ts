import fs from 'node:fs';
import path from 'node:path';
import * as app from './app.js';
import * as migrate from './migrate.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));
vi.mock('../configuration', () => ({
  getVersion: () => '2.0.0',
  getLogLevel: () => 'info',
}));
vi.mock('./migrate');

beforeEach(async () => {
  vi.resetAllMocks();
});

test('createCollections should create collection app when not exist', async () => {
  const db = {
    getCollection: () => null,
    addCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
  };
  const spy = vi.spyOn(db, 'addCollection');
  app.createCollections(db);
  expect(spy).toHaveBeenCalledWith('app');
});

test('createCollections should not create collection app when already exist', async () => {
  const db = {
    getCollection: () => ({
      findOne: () => {},
      insert: () => {},
    }),
    addCollection: () => null,
  };
  const spy = vi.spyOn(db, 'addCollection');
  app.createCollections(db);
  expect(spy).not.toHaveBeenCalled();
});

test('createCollections should call migrate when versions are different', async () => {
  const db = {
    getCollection: () => ({
      findOne: () => ({
        name: 'drydock',
        version: '1.0.0',
      }),
      insert: () => {},
      remove: () => {},
    }),
    addCollection: () => null,
  };
  app.createCollections(db);
  expect(migrate.migrate).toHaveBeenCalledWith('1.0.0', '2.0.0');
});

test('createCollections should not call migrate when versions are identical', async () => {
  const db = {
    getCollection: () => ({
      findOne: () => ({
        name: 'drydock',
        version: '2.0.0',
      }),
      insert: () => {},
      remove: () => {},
    }),
    addCollection: () => null,
  };
  app.createCollections(db);
  expect(migrate.migrate).not.toHaveBeenCalled();
});

test('getAppInfos should return collection content', async () => {
  const db = {
    getCollection: () => ({
      findOne: () => ({
        name: 'drydock',
        version: '1.0.0',
      }),
      insert: () => {},
      remove: () => {},
    }),
    addCollection: () => null,
  };
  app.createCollections(db);
  expect(app.getAppInfos(db)).toStrictEqual({
    name: 'drydock',
    version: '1.0.0',
  });
});

test('isUpgrade should return false when app collection is empty (fresh install)', () => {
  const db = {
    getCollection: () => null,
    addCollection: () => ({
      findOne: () => null,
      insert: () => {},
    }),
  };
  app.createCollections(db);
  expect(app.isUpgrade()).toBe(false);
});

test('isUpgrade should return true when app collection has a previous version (upgrade)', () => {
  const db = {
    getCollection: () => ({
      findOne: () => ({
        name: 'drydock',
        version: '1.3.9',
      }),
      insert: () => {},
      remove: () => {},
    }),
    addCollection: () => null,
  };
  app.createCollections(db);
  expect(app.isUpgrade()).toBe(true);
});

test('store/app should type the app collection variable', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './app.ts'), 'utf8');

  expect(source).not.toContain('let app;');
});
