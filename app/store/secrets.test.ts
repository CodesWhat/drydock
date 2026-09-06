import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as secrets from './secrets.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

describe('Secrets Store', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('getStoredSessionSecret returns null when createCollections has never been called', async () => {
    vi.resetModules();
    const freshSecrets = await import('./secrets.js');
    expect(freshSecrets.getStoredSessionSecret()).toBeNull();
  });

  test('getStoredSessionSecret returns null when no row is stored', () => {
    secrets.createCollections(db);
    expect(secrets.getStoredSessionSecret()).toBeNull();
  });

  test('getStoredSessionSecret returns null when the stored row has no session secret', () => {
    db.prepare('INSERT INTO secrets (id, session_secret) VALUES (1, NULL)').run();
    secrets.createCollections(db);
    expect(secrets.getStoredSessionSecret()).toBeNull();
  });

  test('getStoredSessionSecret returns the stored value when one exists', () => {
    db.prepare('INSERT INTO secrets (id, session_secret) VALUES (1, ?)').run('persisted-secret');
    secrets.createCollections(db);
    expect(secrets.getStoredSessionSecret()).toBe('persisted-secret');
  });

  test('setStoredSessionSecret inserts a row when none exists', () => {
    secrets.createCollections(db);
    secrets.setStoredSessionSecret('new-secret');

    expect(db.prepare('SELECT session_secret FROM secrets WHERE id = 1').get()).toEqual({
      session_secret: 'new-secret',
    });
  });

  test('setStoredSessionSecret replaces an existing value', () => {
    db.prepare('INSERT INTO secrets (id, session_secret) VALUES (1, ?)').run('old-secret');
    secrets.createCollections(db);
    secrets.setStoredSessionSecret('new-secret');

    expect(secrets.getStoredSessionSecret()).toBe('new-secret');
  });

  test('setStoredSessionSecret is idempotent — multiple calls keep last value', () => {
    secrets.createCollections(db);
    secrets.setStoredSessionSecret('first-secret');
    secrets.setStoredSessionSecret('second-secret');

    expect(secrets.getStoredSessionSecret()).toBe('second-secret');
    expect(db.prepare('SELECT COUNT(*) AS n FROM secrets').get()).toEqual({ n: 1 });
  });

  test('setStoredSessionSecret is a no-op when createCollections has not been called', async () => {
    vi.resetModules();
    const freshSecrets = await import('./secrets.js');

    expect(() => freshSecrets.setStoredSessionSecret('secret')).not.toThrow();
  });

  test('setStoredSessionSecret throws when value fails joi validation', () => {
    secrets.createCollections(db);

    // Empty string fails min(1) constraint
    expect(() => secrets.setStoredSessionSecret('')).toThrow();
  });
});
