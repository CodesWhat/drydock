/**
 * DR-121 fix, updated for the SQLite store (roadmap 7-STORE, slice 11): the
 * main store (app/store/index.ts) and express-session's pre-1.8 session
 * store package used to open two independent LokiJS instances on the same
 * /store/dd.json. That engine serialized the whole in-memory database on
 * every save, so whichever
 * instance saved last overwrote everything the other had written (spec
 * section 1.4).
 *
 * Sessions now live in the `sessions` table of the exact same SQLite database
 * every other collection uses — app/api/session-store.ts (the real
 * express-session Store app/api/auth.ts wires in) reads and writes it through
 * app/store/session.ts. There is one writer instead of two independent
 * database instances, so the clobber this file used to reproduce is now
 * structurally impossible: a session write and a container write are two
 * transactions against the same connection, not two competing whole-file
 * serializations. These tests prove that directly — writing sessions and
 * containers interleaved, in either order, across a store.save() checkpoint
 * and a full restart, and asserting neither ever erases the other — and that
 * no second, sibling store file (the old `dd-sessions.json`) is ever created.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionStore } from '../api/session-store.js';
import { createContainerFixture } from '../test/helpers.js';

// SessionStore is imported dynamically inside each test, after
// vi.resetModules(), rather than statically at the top of the file. A static
// import binds to whatever module instance was current the first time this
// file was transformed, before any test ran — every subsequently
// vi.resetModules()'d, freshly `await import('./session.js')`'d instance the
// tests below assert against would then be invisible to it.

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE'] as const;

function setStoreEnv(storePath: string) {
  process.env.DD_STORE_PATH = storePath;
  process.env.DD_STORE_FILE = 'dd.json';
}

function setSessionAsync(store: SessionStore, sid: string, session: object): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(sid, session as never, (error) => (error ? reject(error) : resolve()));
  });
}

function touchSessionAsync(store: SessionStore, sid: string, session: object): Promise<void> {
  return new Promise((resolve) => {
    store.touch(sid, session as never, () => resolve());
  });
}

describe('sessions and the main store share one SQLite writer (roadmap 7-STORE slice 11, DR-121)', () => {
  let tempDir: string;
  let previousEnv: Record<string, string | undefined>;
  let sessionStore: SessionStore | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-store-sessions-'));
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  });

  afterEach(() => {
    sessionStore?.stop();
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

  test('no sibling session file is ever created — sessions live in dd.sqlite itself', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');

    await store.init();

    expect(fs.existsSync(path.join(tempDir, 'dd.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'dd-sessions.json'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'dd.json.pre-1.8.bak'))).toBe(false);
  });

  test('a session write does not remove main-store writes, across a save() checkpoint', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const { SessionStore } = await import('../api/session-store.js');
    const storeContainer = await import('./container.js');
    const sessionModel = await import('./session.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = new SessionStore({ ttlMs: 86400000 });
    await setSessionAsync(sessionStore, 'sid-login', {
      cookie: { originalMaxAge: 86400000 },
      principal: { username: 'admin' },
    });

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();

    expect(storeContainer.getContainerRaw('seed')).toBeDefined();
    expect(storeContainer.getContainerRaw('watched')).toBeDefined();
    expect(sessionModel.getSession('sid-login')).toBeDefined();
  });

  test('a main-store save does not remove sessions', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const { SessionStore } = await import('../api/session-store.js');
    const storeContainer = await import('./container.js');
    const sessionModel = await import('./session.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = new SessionStore({ ttlMs: 86400000 });
    await setSessionAsync(sessionStore, 'sid-login', {
      cookie: { originalMaxAge: 86400000 },
      principal: { username: 'admin' },
    });
    expect(sessionModel.getSession('sid-login')).toBeDefined();

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();

    expect(storeContainer.getContainerRaw('seed')).toBeDefined();
    expect(storeContainer.getContainerRaw('watched')).toBeDefined();
    expect(sessionModel.getSession('sid-login')).toBeDefined();
  });

  test('a touch-driven session update does not remove main-store writes or other sessions', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const { SessionStore } = await import('../api/session-store.js');
    const storeContainer = await import('./container.js');
    const sessionModel = await import('./session.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = new SessionStore({ ttlMs: 86400000 });
    await setSessionAsync(sessionStore, 'sid-login', {
      cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString() },
    });
    const originalExpiresAt = sessionModel.getSession('sid-login')?.expiresAt;

    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();

    // express-session/index.js calls store.touch on any request that carries
    // an existing session cookie and does not modify the session. A distinct
    // cookie.expires from the original set() is what makes the refreshed
    // expiresAt observably different below.
    await touchSessionAsync(sessionStore, 'sid-login', {
      cookie: {
        originalMaxAge: 172800000,
        expires: new Date(Date.now() + 172800000).toISOString(),
      },
    });
    await store.save();

    expect(storeContainer.getContainerRaw('seed')).toBeDefined();
    expect(storeContainer.getContainerRaw('watched')).toBeDefined();
    const touchedSession = sessionModel.getSession('sid-login');
    expect(touchedSession).toBeDefined();
    expect(touchedSession?.expiresAt).not.toBe(originalExpiresAt);
  });

  test('a restart reload sees both the main store and every session written before it', async () => {
    setStoreEnv(tempDir);
    vi.resetModules();
    const store = await import('./index.js');
    const { SessionStore } = await import('../api/session-store.js');
    const storeContainer = await import('./container.js');

    await store.init();
    storeContainer.insertContainer(createContainerFixture({ id: 'seed', name: 'seed' }));
    await store.save();

    sessionStore = new SessionStore({ ttlMs: 86400000 });
    await setSessionAsync(sessionStore, 'sid-login', {
      cookie: { originalMaxAge: 86400000 },
    });
    storeContainer.insertContainer(createContainerFixture({ id: 'watched', name: 'watched' }));
    await store.save();
    sessionStore.stop();
    sessionStore = undefined;

    setStoreEnv(tempDir);
    vi.resetModules();
    const restartedStore = await import('./index.js');
    const restartedContainer = await import('./container.js');
    const restartedSessionModel = await import('./session.js');
    await restartedStore.init();

    expect(restartedContainer.getContainerRaw('seed')).toBeDefined();
    expect(restartedContainer.getContainerRaw('watched')).toBeDefined();
    expect(restartedSessionModel.getSession('sid-login')).toBeDefined();
  });
});
