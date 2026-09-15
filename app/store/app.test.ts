import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as app from './app.js';
import type { Database } from './db/driver.js';
import * as migrate from './migrate.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));
vi.mock('../configuration', () => ({
  getVersion: () => '2.0.0',
  getLogLevel: () => 'info',
}));
vi.mock('./migrate');

describe('App store', () => {
  let db: Database;

  beforeEach(() => {
    vi.resetAllMocks();
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('createCollections does not write until completeStartupInitialization runs', () => {
    app.createCollections(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM app_info').get()).toEqual({ n: 0 });
  });

  test('completeStartupInitialization calls migrate when versions are different', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(migrate.migrate).toHaveBeenCalledWith('1.0.0', '2.0.0');
  });

  test('completeStartupInitialization runs startup repair even when versions are different', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(migrate.repairDataOnStartup).toHaveBeenCalledTimes(1);
  });

  test('completeStartupInitialization does not call migrate when versions are identical', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '2.0.0');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(migrate.migrate).not.toHaveBeenCalled();
  });

  test('completeStartupInitialization runs startup repair when versions are identical', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '2.0.0');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(migrate.migrate).not.toHaveBeenCalled();
    expect(migrate.repairDataOnStartup).toHaveBeenCalledTimes(1);
  });

  test('getAppInfos returns the stored row', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');

    app.createCollections(db);
    expect(app.getAppInfos()).toStrictEqual({ name: 'drydock', version: '1.0.0' });
  });

  test('getAppInfos returns null when no row is stored', () => {
    app.createCollections(db);
    expect(app.getAppInfos()).toBeNull();
  });

  test('completeStartupInitialization rewrites the row to the current version', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(app.getAppInfos()).toStrictEqual({ name: 'drydock', version: '2.0.0' });
  });

  test('isUpgrade returns false on a fresh install with no stored row', () => {
    app.createCollections(db);
    app.completeStartupInitialization();
    expect(app.isUpgrade()).toBe(false);
  });

  test('isUpgrade returns true when a previous version is stored', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.3.9');

    app.createCollections(db);
    app.completeStartupInitialization();

    expect(app.isUpgrade()).toBe(true);
  });

  test('completeStartupInitialization propagates when migrate throws and never advances the stored version', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');
    vi.mocked(migrate.migrate).mockImplementation(() => {
      throw new Error('migrate failed');
    });

    app.createCollections(db);

    expect(() => app.completeStartupInitialization()).toThrow('migrate failed');
    expect(migrate.repairDataOnStartup).not.toHaveBeenCalled();
    expect(app.getAppInfos()).toStrictEqual({ name: 'drydock', version: '1.0.0' });
  });

  test('completeStartupInitialization propagates when repairDataOnStartup throws and never advances the stored version', () => {
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run('drydock', '1.0.0');
    vi.mocked(migrate.repairDataOnStartup).mockImplementation(() => {
      throw new Error('repair failed');
    });

    app.createCollections(db);

    expect(() => app.completeStartupInitialization()).toThrow('repair failed');
    expect(migrate.migrate).toHaveBeenCalledWith('1.0.0', '2.0.0');
    expect(app.getAppInfos()).toStrictEqual({ name: 'drydock', version: '1.0.0' });
  });
});
