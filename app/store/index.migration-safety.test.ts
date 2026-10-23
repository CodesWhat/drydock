import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from './db/driver.js';
import { MIGRATIONS, migrate } from './db/migrations.js';

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;

function snapshotNames(directory: string): string[] {
  return fs.readdirSync(directory).filter((name) => name.includes('.pre-migration-'));
}

async function withStoreDirectory(run: (directory: string) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-safety-'));
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    process.env.DD_STORE_PATH = directory;
    process.env.DD_STORE_FILE = 'dd.json';
    process.env.DD_VERSION = '1.8.0';
    vi.resetModules();
    await run(directory);
  } finally {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
    vi.resetModules();
  }
}

describe('store init migration safety', () => {
  test('a fresh install writes no snapshot', async () => {
    await withStoreDirectory(async (directory) => {
      const store = await import('./index.js');
      await store.init();
      expect(snapshotNames(directory)).toEqual([]);
    });
  });

  test('upgrading an older database snapshots it before applying the pending migration', async () => {
    await withStoreDirectory(async (directory) => {
      const seeded = openDatabase(path.join(directory, 'dd.sqlite'));
      migrate(seeded, MIGRATIONS.slice(0, -1));
      seeded.close();

      const store = await import('./index.js');
      await store.init();

      const [snapshot] = snapshotNames(directory);
      expect(snapshotNames(directory)).toHaveLength(1);
      expect(snapshot).toMatch(/^dd\.sqlite\.pre-migration-v\d+-\d{8}T\d{9}Z$/);
      const restored = openDatabase(path.join(directory, snapshot), { readOnly: true });
      const live = openDatabase(path.join(directory, 'dd.sqlite'), { readOnly: true });
      try {
        const version = (db: typeof live) =>
          Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v);
        expect(version(restored)).toBe(MIGRATIONS.at(-2)?.version);
        expect(version(live)).toBe(MIGRATIONS.at(-1)?.version);
      } finally {
        restored.close();
        live.close();
      }
    });
  });

  test('a database from a newer build stops init with the schema error and leaves it untouched', async () => {
    await withStoreDirectory(async (directory) => {
      const seeded = openDatabase(path.join(directory, 'dd.sqlite'));
      migrate(seeded);
      seeded
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at, note) VALUES (?, 'now', 'future')",
        )
        .run(9999);
      seeded.close();

      const store = await import('./index.js');
      await expect(store.init()).rejects.toThrow(/migrated by a newer Drydock build/);
      expect(snapshotNames(directory)).toEqual([]);
    });
  });
});
