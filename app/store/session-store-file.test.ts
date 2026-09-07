/**
 * DR-121 fix: the main store (app/store/index.ts) and express-session's
 * connect-loki store (built in app/api/auth.ts around lines 416-422) used to
 * open two independent LokiJS instances on the same /store/dd.json. LokiJS
 * serializes the whole in-memory database on every save, so whichever
 * instance saved last overwrote everything the other had written.
 *
 * The fix gives the session store its own sibling file, derived from
 * store.getSessionStorePath(), and has the main store drop a stale `Sessions`
 * collection left behind in dd.json by an older build. These tests assert
 * the two stores use different files and that saving one never erases what
 * the other wrote, including the touch-driven case and a restart reload.
 *
 * Containers moved off dd.json onto the SQLite database next to it (roadmap
 * 7-STORE slice 8), so surviving-container assertions go through
 * app/store/container.js's public functions rather than reading dd.json's
 * `containers` collection directly — dd.json still holds every other Loki
 * collection, which is what the Sessions-collection assertions below keep
 * checking.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ConnectLoki from 'connect-loki';
import session from 'express-session';
import { createContainerFixture } from '../test/helpers.js';

// Exactly app/api/auth.ts:62.
const LokiStore = ConnectLoki(session);

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE'] as const;

function setStoreEnv(storePath: string) {
  process.env.DD_STORE_PATH = storePath;
  process.env.DD_STORE_FILE = 'dd.json';
}

/**
 * Build the session store exactly the way app/api/auth.ts:418-422 does, and
 * wait for connect-loki's loadDatabase() to finish
 * (connect-loki/lib/connect-loki.js:67).
 */
function openSessionStore(sessionStorePath: string): Promise<any> {
  return new Promise((resolve) => {
    const sessionStore: any = new (LokiStore as any)({
      path: sessionStorePath,
      // 30 days in seconds, matching getCookieMaxAge(REMEMBER_ME_DAYS) / 1000.
      ttl: 2592000,
    });
    sessionStore.on('connect', () => resolve(sessionStore));
  });
}

function writeSession(sessionStore: any, sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionStore.set(
      sid,
      { cookie: { originalMaxAge: 86400000 }, principal: { username: 'admin' } },
      (error: unknown) => (error ? reject(error) : resolve()),
    );
  });
}

/** What connect-loki's 5-second autosave does (lokijs.js:2922 -> saveDatabase). */
function saveSessionInstance(sessionStore: any): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionStore.client.saveDatabase((error: unknown) => (error ? reject(error) : resolve()));
  });
}

function stopSessionStore(sessionStore: any) {
  if (!sessionStore) {
    return;
  }
  sessionStore.client?.autosaveDisable?.();
  const daemon = sessionStore.collection?.ttl?.daemon;
  if (daemon) {
    clearInterval(daemon);
  }
}

/** Read a persisted Loki file directly — this is the only state a restart sees. */
function readPersistedCollections(file: string): Record<string, any[]> {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const collections: Record<string, any[]> = {};
  for (const collection of parsed.collections ?? []) {
    collections[collection.name] = collection.data;
  }
  return collections;
}

/** Read container names back through the public store API, not dd.json — containers live in SQLite now. */
function liveContainerNames(containerModule: typeof import('./container.js')): string[] {
  return containerModule.getContainers().map((containerItem: any) => containerItem.name);
}

describe('DR-121 session store owns its own file', () => {
  let tempDir: string;
  let previousEnv: Record<string, string | undefined>;
  let sessionStore: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-dr121-'));
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  });

  afterEach(() => {
    stopSessionStore(sessionStore);
    sessionStore = undefined;
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  test('the session store path is a sibling of the main store file, never the file itself', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    await store.init();

    const configuration = store.getConfiguration();
    const mainStoreFile = path.join(configuration.path, configuration.file);
    const sessionStorePath = store.getSessionStorePath();

    expect(sessionStorePath).not.toBe(mainStoreFile);
    expect(sessionStorePath).toBe(path.join(tempDir, 'dd-sessions.json'));
    expect(path.dirname(sessionStorePath)).toBe(path.dirname(mainStoreFile));
  });

  test('a DD_STORE_FILE with no extension still gets a distinct sibling', async () => {
    process.env.DD_STORE_PATH = tempDir;
    process.env.DD_STORE_FILE = 'ddstore';
    vi.resetModules();
    const store = await import('./index.js');
    await store.init();

    expect(store.getSessionStorePath()).toBe(path.join(tempDir, 'ddstore-sessions.json'));
  });

  test('a session save does not remove main-store writes', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const storeContainer = await import('./container.js');
    const mainStoreFile = path.join(tempDir, 'dd.json');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = await openSessionStore(store.getSessionStorePath());

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();
    expect(liveContainerNames(storeContainer)).toEqual(['seed', 'watched']);

    await writeSession(sessionStore, 'sid-login');
    await saveSessionInstance(sessionStore);

    expect(liveContainerNames(storeContainer)).toEqual(['seed', 'watched']);
    expect(fs.existsSync(mainStoreFile)).toBe(true);
    const sessionsFile = readPersistedCollections(store.getSessionStorePath());
    expect(sessionsFile.Sessions.map((row: any) => row.sid)).toEqual(['sid-login']);
  });

  test('a main-store save does not remove sessions', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const storeContainer = await import('./container.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = await openSessionStore(store.getSessionStorePath());

    await writeSession(sessionStore, 'sid-login');
    await saveSessionInstance(sessionStore);
    expect(
      readPersistedCollections(store.getSessionStorePath()).Sessions.map((row: any) => row.sid),
    ).toEqual(['sid-login']);

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();

    expect(liveContainerNames(storeContainer)).toEqual(['seed', 'watched']);
    expect(
      readPersistedCollections(store.getSessionStorePath()).Sessions.map((row: any) => row.sid),
    ).toEqual(['sid-login']);
  });

  test('a touch-driven session save does not remove main-store writes', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const storeContainer = await import('./container.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = await openSessionStore(store.getSessionStorePath());

    await writeSession(sessionStore, 'sid-login');
    await saveSessionInstance(sessionStore);
    expect(sessionStore.client.autosaveDirty()).toBe(false);

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();

    // express-session/index.js:359-362 calls store.touch on any request that
    // carries an existing session cookie and does not modify the session.
    await new Promise<void>((resolve, reject) => {
      sessionStore.touch('sid-login', { cookie: { originalMaxAge: 86400000 } }, (error: unknown) =>
        error ? reject(error) : resolve(),
      );
    });
    expect(sessionStore.client.autosaveDirty()).toBe(true);

    // ...which is all connect-loki's 5-second autosave needs.
    await saveSessionInstance(sessionStore);

    expect(liveContainerNames(storeContainer)).toEqual(['seed', 'watched']);
    expect(
      readPersistedCollections(store.getSessionStorePath()).Sessions.map((row: any) => row.sid),
    ).toEqual(['sid-login']);
  });

  test('a restart reload sees both the main store and the session store', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const storeContainer = await import('./container.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    const sessionStorePath = store.getSessionStorePath();
    sessionStore = await openSessionStore(sessionStorePath);

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();
    await writeSession(sessionStore, 'sid-login');
    await saveSessionInstance(sessionStore);
    stopSessionStore(sessionStore);
    sessionStore = undefined;

    expect(liveContainerNames(storeContainer)).toEqual(['seed', 'watched']);
    expect(readPersistedCollections(sessionStorePath).Sessions.map((row: any) => row.sid)).toEqual([
      'sid-login',
    ]);

    setStoreEnv(tempDir);
    vi.resetModules();
    const restartedStore = await import('./index.js');
    const restartedContainer = await import('./container.js');
    await restartedStore.init();

    expect(restartedContainer.getContainerRaw('watched')).toBeDefined();
    expect(restartedContainer.getContainerRaw('seed')).toBeDefined();
    expect(liveContainerNames(restartedContainer)).toEqual(['seed', 'watched']);
    expect(
      readPersistedCollections(restartedStore.getSessionStorePath()).Sessions.map(
        (row: any) => row.sid,
      ),
    ).toEqual(['sid-login']);
  });

  test('main-store init drops a stale Sessions collection left in dd.json by an older build', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const mainStoreFile = path.join(tempDir, 'dd.json');

    // Simulate a pre-fix install where the session store's collection was
    // written straight into dd.json by an older LokiStore sharing the file.
    const store = await import('./index.js');
    const storeContainer = await import('./container.js');
    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    const legacySessionStore = await openSessionStore(mainStoreFile);
    await writeSession(legacySessionStore, 'sid-legacy');
    await saveSessionInstance(legacySessionStore);
    stopSessionStore(legacySessionStore);
    expect(readPersistedCollections(mainStoreFile).Sessions).toBeDefined();

    // A restart on the fixed code drops the stale collection from the main
    // store and persists the removal during init() itself — no explicit
    // save() call here, so this is durable even on a store that never
    // writes again.
    vi.resetModules();
    const restartedStore = await import('./index.js');
    const restartedContainer = await import('./container.js');
    await restartedStore.init();
    expect(restartedContainer.getContainerRaw('seed')).toBeDefined();

    expect(readPersistedCollections(mainStoreFile).Sessions).toBeUndefined();
  });

  test('init() does not persist a save when there is no legacy Sessions collection to drop', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');

    // LokiFsAdapter.saveDatabase() (lokijs.js:2435-2445) writes through
    // fs.writeFile before renaming into place, so a call here is the
    // observable signature of a save actually happening.
    const writeFileSpy = vi.spyOn(fs, 'writeFile');
    await store.init();

    expect(writeFileSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
