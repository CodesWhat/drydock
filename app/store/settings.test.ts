import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as settings from './settings.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

function readRow(db: Database) {
  return db.prepare('SELECT internetless_mode, update_mode FROM settings WHERE id = 1').get();
}

describe('Settings Store', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  test('createCollections writes defaults when no row exists', () => {
    settings.createCollections(db);

    expect(readRow(db)).toEqual({ internetless_mode: 0, update_mode: 'manual' });
  });

  test('createCollections preserves automatic updates for a row that predates update mode', () => {
    db.prepare(
      'INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 1, NULL)',
    ).run();

    settings.createCollections(db);

    expect(readRow(db)).toEqual({ internetless_mode: 1, update_mode: 'auto' });
    expect(settings.getSettings().updateMode).toBe('auto');
  });

  test('createCollections preserves an explicitly stored update mode', () => {
    db.prepare(
      "INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 0, 'notify')",
    ).run();

    settings.createCollections(db);

    expect(readRow(db)).toEqual({ internetless_mode: 0, update_mode: 'notify' });
  });

  test('getSettings returns defaults when empty', () => {
    settings.createCollections(db);

    expect(settings.getSettings()).toEqual({ internetlessMode: false, updateMode: 'manual' });
  });

  test('updateSettings merges existing and update values', () => {
    db.prepare(
      'INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 0, NULL)',
    ).run();
    settings.createCollections(db);

    const settingsUpdated = settings.updateSettings({ internetlessMode: true });

    expect(settingsUpdated).toEqual({ internetlessMode: true, updateMode: 'auto' });
    expect(settings.getSettings()).toEqual({ internetlessMode: true, updateMode: 'auto' });
  });

  test('updateSettings supports an empty payload and keeps current values', () => {
    db.prepare(
      'INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 1, NULL)',
    ).run();
    settings.createCollections(db);

    const settingsUpdated = settings.updateSettings();
    expect(settingsUpdated).toEqual({ internetlessMode: true, updateMode: 'auto' });
  });

  test('updateSettings persists and exposes each update mode', () => {
    settings.createCollections(db);

    for (const updateMode of ['notify', 'manual', 'auto'] as const) {
      expect(settings.updateSettings({ updateMode }).updateMode).toBe(updateMode);
      expect(settings.getUpdateMode()).toBe(updateMode);
    }
  });

  test('isInternetlessModeEnabled returns mode state', () => {
    settings.createCollections(db);
    expect(settings.isInternetlessModeEnabled()).toBe(false);

    settings.updateSettings({ internetlessMode: true });
    expect(settings.isInternetlessModeEnabled()).toBe(true);
  });

  test('updateSettings throws when value is invalid', () => {
    settings.createCollections(db);
    expect(() =>
      settings.updateSettings({ internetlessMode: 'yes' as unknown as boolean }),
    ).toThrow();
  });

  test('getSettings caches validated settings and invalidates the cache after writes', () => {
    db.prepare(
      'INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 0, NULL)',
    ).run();
    settings.createCollections(db);

    const readSpy = vi.spyOn(db, 'prepare');
    readSpy.mockClear();

    settings.getSettings();
    const callsAfterFirstGet = readSpy.mock.calls.length;
    settings.getSettings();
    expect(readSpy.mock.calls.length).toBe(callsAfterFirstGet);

    settings.updateSettings({ internetlessMode: true });
    const settingsAfterWrite = settings.getSettings();
    expect(settingsAfterWrite).toEqual({ internetlessMode: true, updateMode: 'auto' });
    expect(readSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstGet);

    readSpy.mockRestore();
  });

  test('getSettings falls back to defaults when the persisted row disappears after cache invalidation', () => {
    db.prepare(
      'INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, 1, NULL)',
    ).run();
    settings.createCollections(db);
    settings.updateSettings({ internetlessMode: true });

    db.prepare('DELETE FROM settings').run();
    // Cache was invalidated by the write above, so the next read hits the table.
    expect(settings.getSettings()).toEqual({ internetlessMode: false, updateMode: 'manual' });
  });

  test('updateSettings does not fail before createCollections initializes storage', async () => {
    vi.resetModules();
    const freshSettings = await import('./settings.js');

    expect(freshSettings.updateSettings({ internetlessMode: true })).toEqual({
      internetlessMode: true,
      updateMode: 'manual',
    });
  });
});
