import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Loki from 'lokijs';
import { createContainerFixture } from '../test/helpers.js';

const ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;

async function withLegacyStore(
  collectionName: 'containers' | 'updateOperations',
  check: (store: typeof import('./index.js'), filename: string, secret: string) => Promise<void>,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-env-cleanup-'));
  const filename = path.join(directory, 'dd.json');
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousUmask = process.umask();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const secret = 'fixture-legacy-container-private-value-1523';

  try {
    const seed = new Loki(filename);
    seed.addCollection('app').insert({ name: 'drydock', version: '1.7.1' });
    const container = createContainerFixture({
      details: {
        ports: [],
        volumes: [],
        env: [
          { key: 'DB_PASSWORD', value: secret },
          { key: 'PUBLIC_MODE', value: 'visible-setting' },
        ],
      },
    });
    const now = new Date().toISOString();
    seed.addCollection(collectionName).insert({
      data:
        collectionName === 'containers'
          ? container
          : {
              id: 'legacy-operation',
              containerName: container.name,
              container,
              status: 'succeeded',
              phase: 'succeeded',
              createdAt: now,
              updatedAt: now,
              completedAt: now,
            },
    });
    const operations =
      seed.getCollection('updateOperations') || seed.addCollection('updateOperations');
    operations.insert({
      data: {
        id: 'snapshotless-operation',
        containerName: 'other',
        status: 'succeeded',
        phase: 'succeeded',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
    });
    fs.writeFileSync(filename, seed.serialize());
    expect(fs.readFileSync(filename, 'utf8')).toContain(secret);
    process.env.DD_STORE_PATH = directory;
    process.env.DD_STORE_FILE = 'dd.json';
    process.env.DD_VERSION = '1.7.1';
    vi.resetModules();

    const store = await import('./index.js');
    await check(store, filename, secret);
  } finally {
    for (const result of intervals.mock.results) {
      if (result.type === 'return') clearInterval(result.value);
    }
    intervals.mockRestore();
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.umask(previousUmask);
    fs.rmSync(directory, { recursive: true, force: true });
    vi.resetModules();
  }
}

test.each(['containers', 'updateOperations'] as const)(
  'startup persists redaction in existing JSON %s before resolving',
  async (collectionName) => {
    await withLegacyStore(collectionName, async (store, filename, secret) => {
      await store.init();
      const persisted = fs.readFileSync(filename, 'utf8');
      expect(persisted).not.toContain(secret);
      expect(persisted).toContain('visible-setting');
      const snapshotless = JSON.parse(persisted)
        .collections.find((collection) => collection.name === 'updateOperations')
        .data.find((doc) => doc.data.id === 'snapshotless-operation');
      expect(snapshotless.data).not.toHaveProperty('container');

      vi.resetModules();
      const restartedStore = await import('./index.js');
      await restartedStore.init();
      expect(fs.readFileSync(filename, 'utf8')).toBe(persisted);
    });
  },
);

test('startup rejects a failed cleanup save and retries cleanup on the next start', async () => {
  await withLegacyStore('containers', async (store, filename, secret) => {
    const write = vi.spyOn(fs, 'writeFile').mockImplementationOnce((...args) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') callback(new Error('fixture cleanup-save failure'));
    });
    try {
      await expect(store.init()).rejects.toThrow('fixture cleanup-save failure');
      expect(fs.readFileSync(filename, 'utf8')).toContain(secret);
    } finally {
      write.mockRestore();
    }

    await store.init();
    expect(fs.readFileSync(filename, 'utf8')).not.toContain(secret);
  });
});

test('startup scrubs *_KEY values left by the earlier pass and logs counts only (#1523)', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-env-rescrub-'));
  const filename = path.join(directory, 'dd.json');
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const secrets = ['fixture-enc-key-1523', 'fixture-master-key-1523'];

  try {
    const seed = new Loki(filename);
    seed.addCollection('app').insert({ name: 'drydock', version: '1.7.1' });
    // The shape rc.4 persisted: DB_PASSWORD already redacted, *_KEY still raw.
    seed.addCollection('containers').insert({
      data: createContainerFixture({
        details: {
          ports: [],
          volumes: [],
          env: [
            { key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true },
            { key: 'ENCRYPTION_KEY', value: secrets[0], sensitive: false },
            { key: 'LITELLM_MASTER_KEY', value: secrets[1], sensitive: false },
            { key: 'PUBLIC_MODE', value: 'visible-setting', sensitive: false },
            null,
            { value: 'keyless' },
          ],
        },
      }),
    });
    fs.writeFileSync(filename, seed.serialize());
    process.env.DD_STORE_PATH = directory;
    process.env.DD_STORE_FILE = 'dd.json';
    process.env.DD_VERSION = '1.7.1';
    vi.resetModules();
    const info = vi.fn();
    vi.doMock('../log/index.js', () => ({
      default: { child: () => ({ info, warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
    }));

    const store = await import('./index.js');
    await store.init();

    const persisted = fs.readFileSync(filename, 'utf8');
    for (const secret of secrets) {
      expect(persisted).not.toContain(secret);
    }
    expect(persisted).toContain('visible-setting');
    expect(info).toHaveBeenCalledWith('Redacted 2 sensitive env values in 1 containers');
    const loggedText = JSON.stringify(info.mock.calls);
    for (const secret of secrets) {
      expect(loggedText).not.toContain(secret);
    }

    // A second start has nothing left to redact and says nothing about it.
    info.mockClear();
    vi.resetModules();
    const restarted = await import('./index.js');
    await restarted.init();
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('Redacted'));
  } finally {
    for (const result of intervals.mock.results) {
      if (result.type === 'return') clearInterval(result.value);
    }
    intervals.mockRestore();
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
    vi.doUnmock('../log/index.js');
    vi.resetModules();
  }
});
