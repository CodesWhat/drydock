import { argon2Sync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { configFileSources, ddEnvVars, replaceSecrets } from '../index.js';
import { resetConfigFileLayer, setConfigFileLayer } from './layer.js';
import { loadConfigFile } from './loader.js';
import type { ConfigurationReloadResult } from './reload.js';
import { mergeConfigLayers } from './sources.js';
import { validateConfiguration } from './validate.js';

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

  test('validates untouched interpolation and secret-file references like startup', async () => {
    const credentialPath = path.join(tempDir, 'credential');
    fs.writeFileSync(credentialPath, 'private-sentinel\n', { mode: 0o600 });
    writeFixture(
      'watcher:\n  local:\n    cron: "0 */6 * * *"\n' +
        'notification:\n  discord:\n    private:\n      url: ${WEBHOOK_URL:-https://discord.example/hook}\n' +
        `registry:\n  hub:\n    private:\n      login: reader\n      password:\n        _file: ${credentialPath}\n`,
    );
    const before = readRaw();
    const startupEnv = { ...ddEnvVars };
    mergeConfigLayers(startupEnv, await loadConfigFile({ DD_CONFIG_FILE: configPath }));
    await replaceSecrets(startupEnv);
    expect(await validateConfiguration(startupEnv)).toEqual({ errors: [] });
    const outcome = await writeConfigurationSection('watcher', {
      local: { cron: '0 */8 * * *' },
    });
    expect(outcome.kind).toBe('written');
    expect(readRaw().slice(readRaw().indexOf('notification:'))).toBe(
      before.slice(before.indexOf('notification:')),
    );
    expect(readRaw()).not.toContain('private-sentinel');
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

  test('refuses an unresolved secret before saving and does not expose the private path', async () => {
    writeFixture(
      `watcher:\n  local:\n    cron: "0 */6 * * *"\nregistry:\n  hub:\n    private:\n      password:\n        _file: ${path.join(tempDir, 'private-secret-path')}\n`,
    );
    const before = readRaw();
    await expect(
      writeConfigurationSection('watcher', { local: { cron: '0 */8 * * *' } }),
    ).rejects.toThrow(/^Unable to resolve configuration secret files$/);
    expect(readRaw()).toBe(before);
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockReloadConfiguration).not.toHaveBeenCalled();
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

    expect(outcome).toStrictEqual({ kind: 'no-file', section: 'notification' });
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

  // A section is flattened to DD_<SECTION>_..., so a name with an underscore in
  // it lands in another section: `auth_basic_eve` writes DD_AUTH_BASIC_EVE_*,
  // the `auth` section. Every check the engine keys on the section name has to
  // look at the section the keys actually belong to.
  describe('section names', () => {
    const salt = randomBytes(32);
    const HASH = `argon2id$19456$2$4$${salt.toString('base64')}$${argon2Sync('argon2id', {
      message: 'correct horse battery staple',
      nonce: salt,
      memory: 19456,
      passes: 2,
      parallelism: 4,
      tagLength: 64,
    }).toString('base64')}`;
    const NEW_URL = 'https://new.example/hook';
    const NEW_HOOK = { discord: { myhook: { url: NEW_URL } } };
    const NEW_ACCOUNT = { basic: { eve: { user: 'eve', hash: HASH } } };

    function notASection(name: string, parent?: string) {
      return {
        kind: 'invalid',
        section: name.trim().toLowerCase(),
        errors: [
          {
            path: 'document',
            envKey: 'DD_CONFIG_FILE',
            message:
              `"${name.trim()}" is not a configuration section name. A section is one ` +
              'top-level key of the file, letters and digits only' +
              (parent
                ? `; this name would flatten into the "${parent}" section, so write ` +
                  `"${parent}" with the value nested inside it.`
                : '.'),
          },
        ],
      };
    }

    function expectNothingWritten(before: string): void {
      expect(readRaw()).toBe(before);
      expect(mockRename).not.toHaveBeenCalled();
      expect(mockReloadConfiguration).not.toHaveBeenCalled();
    }

    test.each([
      ['auth_basic_eve', { user: 'eve', hash: HASH }, 'auth'],
      ['AUTH_Basic_Eve', { user: 'eve', hash: HASH }, 'auth'],
      [' auth_totp ', { allowhttp: true }, 'auth'],
      ['auth_', NEW_ACCOUNT, 'auth'],
      ['server_webhook', { secret: 'hunter2hunter2' }, 'server'],
      ['notification_discord_myhook', { url: NEW_URL }, 'notification'],
      ['settings_foo', { updatemode: 'auto' }, 'settings'],
      ['api_keys_ci', { scopes: 'admin' }, 'api'],
    ])(
      'refuses %j, which would flatten into another section, and names that section',
      async (name, body, parent) => {
        writeFixture(FIXTURE_WITH_COMMENTS);
        const before = readRaw();

        const outcome = await writeConfigurationSection(name, body);

        expect(outcome).toStrictEqual(notASection(name, parent));
        expectNothingWritten(before);
      },
    );

    test.each([
      ['_auth'],
      ['__proto__'],
      ['a-b'],
      ['auth.basic'],
      ['auth/basic'],
      ['auth basic'],
      ['Kafka'],
      [''],
      ['   '],
    ])('refuses %j, which is not a key at all', async (name) => {
      writeFixture(FIXTURE_WITH_COMMENTS);
      const before = readRaw();

      const outcome = await writeConfigurationSection(name, NEW_HOOK);

      expect(outcome).toStrictEqual(notASection(name));
      expectNothingWritten(before);
    });

    test('refuses a name that is not a section before it looks for a file', async () => {
      const outcome = await writeConfigurationSection('auth_basic_eve', {
        user: 'eve',
        hash: HASH,
      });

      expect(outcome).toStrictEqual(notASection('auth_basic_eve', 'auth'));
    });

    test.each([['auth'], ['AUTH'], [' auth ']])(
      'writes an account under %j as the auth section, with its keys and the restart reported',
      async (name) => {
        writeFixture(FIXTURE_WITH_COMMENTS);

        const outcome = await writeConfigurationSection(name, NEW_ACCOUNT);

        expect(outcome).toMatchObject({
          kind: 'written',
          section: 'auth',
          changedKeys: ['DD_AUTH_BASIC_EVE_HASH', 'DD_AUTH_BASIC_EVE_USER'],
          restartRequired: true,
        });
        expect(Object.keys(yaml.parse(readRaw()))).toEqual(['server', 'notification', 'auth']);
      },
    );

    test.each([['notification'], ['NOTIFICATION'], [' Notification ']])(
      'runs every check against the notification section for %j',
      async (name) => {
        writeFixture(FIXTURE_WITH_COMMENTS);

        const outcome = await writeConfigurationSection(name, NEW_HOOK);

        expect(outcome).toMatchObject({
          kind: 'written',
          section: 'notification',
          changedKeys: ['DD_NOTIFICATION_DISCORD_MYHOOK_URL'],
          restartRequired: false,
        });
        expect(Object.keys(yaml.parse(readRaw()))).toEqual(['server', 'notification']);
      },
    );

    describe('with the key set by the environment', () => {
      beforeEach(() => {
        ddEnvVars.DD_NOTIFICATION_DISCORD_MYHOOK_URL = 'https://env-set.example/hook';
        configFileSources.DD_NOTIFICATION_DISCORD_MYHOOK_URL = 'env';
      });

      test.each([['notification'], ['NOTIFICATION'], [' Notification ']])(
        'refuses %j as env-sourced and names the key and the section',
        async (name) => {
          writeFixture(FIXTURE_WITH_COMMENTS);
          const before = readRaw();

          const outcome = await writeConfigurationSection(name, NEW_HOOK);

          expect(outcome).toStrictEqual({
            kind: 'env-sourced',
            section: 'notification',
            keys: ['DD_NOTIFICATION_DISCORD_MYHOOK_URL'],
          });
          expectNothingWritten(before);
        },
      );

      test.each([
        ['notification_discord_myhook', { url: NEW_URL }],
        ['NOTIFICATION_DISCORD_MYHOOK', { url: NEW_URL }],
        [' notification_Discord_MyHook ', { url: NEW_URL }],
        ['notification_discord', { myhook: { url: NEW_URL } }],
        ['notification_', NEW_HOOK],
      ])('cannot reach the key through %j either', async (name, body) => {
        writeFixture(FIXTURE_WITH_COMMENTS);
        const before = readRaw();

        const outcome = await writeConfigurationSection(name, body);

        expect(outcome).toStrictEqual(notASection(name, 'notification'));
        expectNothingWritten(before);
      });
    });

    test.each([
      ['settings', 'settings'],
      ['ui_preferences', 'ui_preferences'],
      ['notification_rules', 'notification_rules'],
      ['api_keys', 'api_keys'],
      [' API_Keys ', 'api_keys'],
    ])('still points the DB-owned name %j at the settings API', async (name, section) => {
      writeFixture(FIXTURE_WITH_COMMENTS);
      const before = readRaw();

      const outcome = await writeConfigurationSection(name, { anything: 'at all' });

      expect(outcome).toStrictEqual({ kind: 'db-owned', section });
      expectNothingWritten(before);
    });

    // There is no list of sections to check a name against: the file mirrors
    // the DD_* tree, which is open-ended. A one-key name nothing reads is inert
    // and is checked exactly like any other section.
    test('treats a one-key name nothing reads as a section, checked like any other', async () => {
      writeFixture(FIXTURE_WITH_COMMENTS);

      const outcome = await writeConfigurationSection('banana', { peel: 'yes' });

      expect(outcome).toMatchObject({
        kind: 'written',
        section: 'banana',
        changedKeys: ['DD_BANANA_PEEL'],
        restartRequired: true,
      });

      ddEnvVars.DD_BANANA_PEEL = 'no';
      configFileSources.DD_BANANA_PEEL = 'env';
      expect(await writeConfigurationSection('banana', { peel: 'yes' })).toStrictEqual({
        kind: 'env-sourced',
        section: 'banana',
        keys: ['DD_BANANA_PEEL'],
      });
    });

    test('names the section on an invalid body', async () => {
      writeFixture(FIXTURE_WITH_COMMENTS);

      expect(await writeConfigurationSection(' Security ', { scanner: 'bogus' })).toMatchObject({
        kind: 'invalid',
        section: 'security',
      });
      expect(
        await writeConfigurationSection(' Notification ', ['not', 'a', 'mapping']),
      ).toMatchObject({ kind: 'invalid', section: 'notification' });
    });
  });
});
