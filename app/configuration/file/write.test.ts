import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { configFileSources, ddEnvVars } from '../index.js';
import { resetConfigFileLayer, setConfigFileLayer } from './layer.js';
import type { ConfigurationReloadResult } from './reload.js';

const mockRename = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());
const mockOpen = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  mockRename.mockImplementation(actual.rename);
  mockUnlink.mockImplementation(actual.unlink);
  mockOpen.mockImplementation(actual.open);
  return { ...actual, rename: mockRename, unlink: mockUnlink, open: mockOpen };
});

const mockReloadConfiguration = vi.hoisted(() => vi.fn());
vi.mock('./reload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reload.js')>();
  return { ...actual, reloadConfiguration: mockReloadConfiguration };
});

const { writeConfigurationSection } = await import('./write.js');

function defaultReloadResult(): ConfigurationReloadResult {
  return {
    applied: true,
    errors: [],
    diff: { changed: [], reload: [], restart: [] },
    reconcile: { added: [], changed: [], removed: [], unchanged: [], errors: [] },
    orphanedRules: [],
  };
}

describe('writeConfigurationSection', () => {
  let ddEnvVarsSnapshot: Record<string, string | undefined>;
  let configFileSourcesSnapshot: Record<string, string>;
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReloadConfiguration.mockResolvedValue(defaultReloadResult());
    ddEnvVarsSnapshot = { ...ddEnvVars };
    configFileSourcesSnapshot = { ...configFileSources };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-config-write-test-'));
    configPath = path.join(tempDir, 'drydock.yml');
  });

  afterEach(() => {
    for (const key of Object.keys(ddEnvVars)) {
      delete ddEnvVars[key];
    }
    Object.assign(ddEnvVars, ddEnvVarsSnapshot);
    for (const key of Object.keys(configFileSources)) {
      delete configFileSources[key];
    }
    Object.assign(configFileSources, configFileSourcesSnapshot);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigFileLayer();
  });

  function writeFixture(content: string): void {
    fs.writeFileSync(configPath, content, 'utf-8');
    fs.chmodSync(configPath, 0o600);
    setConfigFileLayer({}, new Set(), { path: configPath, modifiedAt: new Date().toISOString() });
  }

  function readRaw(): string {
    return fs.readFileSync(configPath, 'utf-8');
  }

  const FIXTURE_WITH_COMMENTS =
    '# top-of-file comment\n' +
    'server:\n' +
    '  port: 3000 # port comment\n' +
    '\n' +
    '# notification section comment\n' +
    'notification:\n' +
    '  discord:\n' +
    '    myhook:\n' +
    '      url: https://old.example/hook\n';

  test('a write followed by a read returns the new value', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);

    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome.kind).toBe('written');
    const parsed = yaml.parse(readRaw());
    expect(parsed.notification.discord.myhook.url).toBe('https://new.example/hook');
  });

  test('comments and key order survive a write to one section', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);

    await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    const raw = readRaw();
    expect(raw).toContain('# top-of-file comment');
    expect(raw).toContain('# port comment');
    expect(raw).toContain('# notification section comment');
    expect(raw.indexOf('server:')).toBeLessThan(raw.indexOf('notification:'));
  });

  test('preserves the existing top-level key casing when replacing a section', async () => {
    writeFixture('Notification:\n  discord:\n    myhook:\n      url: https://old.example/hook\n');

    await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    const raw = readRaw();
    expect(raw).toContain('Notification:');
    expect(raw).not.toContain('\nnotification:');
  });

  test('refuses with env-sourced and names the offending key, leaving the file untouched', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL = 'https://env-set.example/hook';
    configFileSources.DD_NOTIFICATION_DISCORD_MYHOOK_URL = 'env';
    const before = readRaw();

    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome.kind).toBe('env-sourced');
    if (outcome.kind === 'env-sourced') {
      expect(outcome.keys).toContain('DD_NOTIFICATION_DISCORD_MYHOOK_URL');
    }
    expect(readRaw()).toBe(before);
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
  });

  test('refuses a DB-owned section even when no config file is configured', async () => {
    const outcome = await writeConfigurationSection('settings', { updateMode: 'auto' });

    expect(outcome).toStrictEqual({ kind: 'db-owned', section: 'settings' });
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
  });

  test('refuses with no-file when no configuration file is configured', async () => {
    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome).toStrictEqual({ kind: 'no-file' });
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
  });

  test('refuses an invalid body with Joi paths, leaving the file byte-identical', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const before = readRaw();

    const outcome = await writeConfigurationSection('security', { scanner: 'bogus' });

    expect(outcome.kind).toBe('invalid');
    if (outcome.kind === 'invalid') {
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0].envKey).toBe('DD_SECURITY_SCANNER');
    }
    expect(readRaw()).toBe(before);
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
  });

  test('refuses a structurally invalid body (a sequence value), leaving the file byte-identical', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const before = readRaw();

    const outcome = await writeConfigurationSection('notification', ['not', 'a', 'mapping']);

    expect(outcome.kind).toBe('invalid');
    expect(readRaw()).toBe(before);
  });

  test('a failing rename leaves the original file intact', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const before = readRaw();
    mockRename.mockRejectedValueOnce(new Error('rename failed'));

    await expect(
      writeConfigurationSection('notification', {
        discord: { myhook: { url: 'https://new.example/hook' } },
      }),
    ).rejects.toThrow('rename failed');

    expect(readRaw()).toBe(before);
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
  });

  test('skips a non-string top-level key while searching for the section', async () => {
    writeFixture(
      '123: unrelated\nnotification:\n  discord:\n    myhook:\n      url: https://old.example/hook\n',
    );

    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome.kind).toBe('written');
    const parsed = yaml.parse(readRaw());
    expect(parsed.notification.discord.myhook.url).toBe('https://new.example/hook');
  });

  test('creates a fresh top-level key when the file is empty', async () => {
    writeFixture('');

    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome.kind).toBe('written');
    const parsed = yaml.parse(readRaw());
    expect(parsed.notification.discord.myhook.url).toBe('https://new.example/hook');
  });

  test('a rename failure whose cleanup unlink also fails still surfaces the rename error', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const before = readRaw();
    mockRename.mockRejectedValueOnce(new Error('rename failed'));
    mockUnlink.mockRejectedValueOnce(new Error('unlink failed'));

    await expect(
      writeConfigurationSection('notification', {
        discord: { myhook: { url: 'https://new.example/hook' } },
      }),
    ).rejects.toThrow('rename failed');

    expect(readRaw()).toBe(before);
  });

  test('a write failure inside the temp-file handle still unlinks the temp file and leaves the target untouched', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const before = readRaw();
    const fakeClose = vi.fn().mockResolvedValue(undefined);
    mockOpen.mockImplementationOnce(
      async () =>
        ({
          writeFile: vi.fn().mockRejectedValue(new Error('write failed')),
          sync: vi.fn(),
          close: fakeClose,
          // Minimal fake FileHandle: only the three methods writeFileAtomically calls.
        }) as any,
    );

    await expect(
      writeConfigurationSection('notification', {
        discord: { myhook: { url: 'https://new.example/hook' } },
      }),
    ).rejects.toThrow('write failed');

    expect(fakeClose).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining(path.join(tempDir, '.drydock.yml.tmp-')),
    );
    expect(readRaw()).toBe(before);
  });

  test('the resulting file has mode 0600', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    fs.chmodSync(configPath, 0o644);

    await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    const mode = fs.statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('succeeds and reports restartRequired for a restart-only section', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);

    const outcome = await writeConfigurationSection('server', { port: 4000 });

    expect(outcome.kind).toBe('written');
    if (outcome.kind === 'written') {
      expect(outcome.restartRequired).toBe(true);
    }
  });

  test('reports restartRequired: false for a reloadable section', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);

    const outcome = await writeConfigurationSection('notification', {
      discord: { myhook: { url: 'https://new.example/hook' } },
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind === 'written') {
      expect(outcome.restartRequired).toBe(false);
      expect(outcome.changedKeys).toContain('DD_NOTIFICATION_DISCORD_MYHOOK_URL');
      expect(outcome.reload).toBe(await mockReloadConfiguration.mock.results[0].value);
    }
  });

  test('serializes concurrent writes rather than interleaving their reads and writes', async () => {
    writeFixture(FIXTURE_WITH_COMMENTS);
    const callOrder: string[] = [];
    const realReadFile = fsPromises.readFile;
    const readFileSpy = vi
      .spyOn(fsPromises, 'readFile')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.readFile>) => {
        callOrder.push('read-start');
        const result = await (realReadFile as (...a: unknown[]) => Promise<unknown>)(...args);
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push('read-end');
        return result as never;
      });

    await Promise.all([
      writeConfigurationSection('notification', {
        discord: { myhook: { url: 'https://a.example/hook' } },
      }),
      writeConfigurationSection('notification', {
        discord: { myhook: { url: 'https://b.example/hook' } },
      }),
    ]);

    expect(callOrder).toEqual(['read-start', 'read-end', 'read-start', 'read-end']);
    readFileSpy.mockRestore();
  });
});
