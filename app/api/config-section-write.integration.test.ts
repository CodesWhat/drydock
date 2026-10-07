/**
 * `PUT /api/v1/config/:section` over a loopback listener, with the real router,
 * the real write engine and the real component schemas underneath it.
 * `config.test.ts` mocks the engine and `write.test.ts` never sees a request, so
 * neither can show what a section name does on its way from the URL to the file.
 * Only the reload a write triggers and the audit store are replaced.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import yaml from 'yaml';
import { resetConfigFileLayer, setConfigFileLayer } from '../configuration/file/layer.js';
import { configFileSources, ddEnvVars } from '../configuration/index.js';
import * as configRouter from './config.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';
import type { PrincipalCarrier } from './principal.js';

const { reload, audit } = vi.hoisted(() => ({ reload: vi.fn(), audit: vi.fn() }));
vi.mock('../configuration/file/reload.js', () => ({ reloadConfiguration: reload }));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: audit }));

const salt = randomBytes(32);
const HASH = `argon2id$19456$2$4$${salt.toString('base64')}$${argon2Sync('argon2id', {
  message: 'correct horse battery staple',
  nonce: salt,
  memory: 19456,
  passes: 2,
  parallelism: 4,
  tagLength: 64,
}).toString('base64')}`;

const FIXTURE =
  '# keep this comment\n' +
  'server:\n' +
  '  port: 3000\n' +
  'notification:\n' +
  '  discord:\n' +
  '    myhook:\n' +
  '      url: https://old.example/hook\n';
const NEW_URL = 'https://new.example/hook';
const NEW_HOOK = { discord: { myhook: { url: NEW_URL } } };
const NEW_ACCOUNT = { basic: { eve: { user: 'eve', hash: HASH } } };
const ACCOUNT_KEYS = ['DD_AUTH_BASIC_EVE_HASH', 'DD_AUTH_BASIC_EVE_USER'];
const HOOK_KEY = 'DD_NOTIFICATION_DISCORD_MYHOOK_URL';
const RECOVERY_PRINCIPAL = {
  kind: 'session',
  username: 'scott',
  identity: {
    type: 'local',
    subjectId: 's'.repeat(64),
    providerId: 'basic.default',
    assurance: 'recovery',
    factorVersion: 1,
    issuedAt: 1,
  },
};

describe('PUT /api/v1/config/:section, from the URL to the file', () => {
  let server: http.Server;
  let port: number;
  let directory: string;
  let configPath: string;
  let envSnapshot: Record<string, string | undefined>;
  let sourcesSnapshot: Record<string, string>;
  // The router's five-a-minute write limiter is keyed by client address, so
  // every request arrives from an address of its own.
  let addressSerial = 0;

  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json({ limit: '256kb' }));
    app.use((req, _res, next) => {
      if (req.get('X-Test-Principal') === 'recovery') {
        (req as PrincipalCarrier).principal = RECOVERY_PRINCIPAL as PrincipalCarrier['principal'];
      }
      next();
    });
    app.use('/api/v1/config', configRouter.init());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
    port = address.port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reload.mockResolvedValue({
      applied: true,
      errors: [],
      diff: { changed: [], reload: [], restart: [] },
      reconcile: { added: [], changed: [], removed: [], unchanged: [], errors: [] },
      orphanedRules: [],
    });
    envSnapshot = { ...ddEnvVars };
    sourcesSnapshot = { ...configFileSources };
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-section-write-http-'));
    configPath = path.join(directory, 'drydock.yml');
    fs.writeFileSync(configPath, FIXTURE, { mode: 0o600 });
    setConfigFileLayer({}, new Set(), { path: configPath, modifiedAt: new Date().toISOString() });
  });

  afterEach(() => {
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    Object.assign(ddEnvVars, envSnapshot);
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(configFileSources, sourcesSnapshot);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function put(section: string, body: unknown, headers: Record<string, string> = {}) {
    addressSerial += 1;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/config/${encodeURIComponent(section)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.${addressSerial >> 8}.${addressSerial & 255}`,
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  function expectContract(statusCode: string, payload: unknown): void {
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/{section}',
        method: 'put',
        statusCode,
        payload,
      }),
    ).toEqual({ valid: true, errors: [] });
  }

  function expectAudit(status: 'info' | 'error', details: string): void {
    expect(audit.mock.calls).toEqual([
      [{ action: 'config-written', containerName: 'diagnostics', status, details }],
    ]);
  }

  function expectFileUntouched(): void {
    expect(fs.readFileSync(configPath, 'utf8')).toBe(FIXTURE);
    expect(reload).not.toHaveBeenCalled();
  }

  function setByTheEnvironment(key: string, value: string): void {
    ddEnvVars[key] = value;
    configFileSources[key] = 'env';
  }

  /** The hook as a `_file` node, pointing at a secret file that holds `NEW_URL`. */
  function secretFileHook() {
    const secretPath = path.join(directory, 'hook-secret');
    fs.writeFileSync(secretPath, `${NEW_URL}\n`, { mode: 0o600 });
    return { discord: { myhook: { url: { _file: secretPath } } } };
  }

  test.each([
    ['auth', NEW_ACCOUNT, 'auth', ACCOUNT_KEYS, true],
    ['AUTH', NEW_ACCOUNT, 'auth', ACCOUNT_KEYS, true],
    [' auth ', NEW_ACCOUNT, 'auth', ACCOUNT_KEYS, true],
    ['server', { port: 4000 }, 'server', ['DD_SERVER_PORT'], true],
    ['notification', NEW_HOOK, 'notification', [HOOK_KEY], false],
    [' Notification ', NEW_HOOK, 'notification', [HOOK_KEY], false],
    ['banana', { peel: 'yes' }, 'banana', ['DD_BANANA_PEEL'], true],
  ])(
    'writes %j and reports the section, its changed keys and the restart in the response and the audit entry',
    async (name, body, section, changedKeys, restartRequired) => {
      const response = await put(name, body);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ applied: true, section, changedKeys, restartRequired });
      expectContract('200', response.body);
      expectAudit(
        'info',
        `Wrote configuration section "${section}": ${changedKeys.length} key(s) changed` +
          (restartRequired ? ' (restart required)' : ''),
      );
      const topLevelKeys = Object.keys(yaml.parse(fs.readFileSync(configPath, 'utf8')));
      expect(topLevelKeys.filter((key) => key.toLowerCase() === section)).toEqual([section]);
      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['auth_basic_eve', { user: 'eve', hash: HASH }, 'auth'],
    ['AUTH_Basic_Eve', { user: 'eve', hash: HASH }, 'auth'],
    ['auth_totp', { allowhttp: true }, 'auth'],
    ['server_webhook', { secret: 'hunter2hunter2' }, 'server'],
    ['notification_discord_myhook', { url: NEW_URL }, 'notification'],
    ['settings_foo', { updatemode: 'auto' }, 'settings'],
  ])(
    'refuses %j with 400 and points at the section it would have flattened into',
    async (name, body, parent) => {
      const response = await put(name, body);

      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({
        errors: [
          {
            path: 'document',
            envKey: 'DD_CONFIG_FILE',
            message:
              `"${name}" is not a configuration section name. A section is one top-level key ` +
              `of the file, letters and digits only; this name would flatten into the "${parent}" ` +
              `section, so write "${parent}" with the value nested inside it.`,
          },
        ],
      });
      expectContract('400', response.body);
      expectAudit(
        'error',
        `Wrote configuration section "${name.toLowerCase()}": refused (1 error(s))`,
      );
      expectFileUntouched();
    },
  );

  test('refuses a name with punctuation in it with 400', async () => {
    const response = await put('a-b', { c: 'd' });

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({
      errors: [
        {
          path: 'document',
          envKey: 'DD_CONFIG_FILE',
          message:
            '"a-b" is not a configuration section name. A section is one top-level key of the ' +
            'file, letters and digits only.',
        },
      ],
    });
    expectContract('400', response.body);
    expectFileUntouched();
  });

  test.each([['settings'], ['api_keys']])(
    'still answers 409 for the DB-owned name %j',
    async (name) => {
      const response = await put(name, { anything: 'at all' });

      expect(response.status).toBe(409);
      expect(response.body).toStrictEqual({
        error: `Section "${name}" is managed through PATCH /api/v1/settings, not the configuration file.`,
      });
      expectAudit('error', `Wrote configuration section "${name}": refused (DB-owned section)`);
      expectFileUntouched();
    },
  );

  describe('with the key set by the environment', () => {
    beforeEach(() => setByTheEnvironment(HOOK_KEY, 'https://env-set.example/hook'));

    test.each([['notification'], ['NOTIFICATION'], [' notification ']])(
      'refuses %j with 409, naming the key and the section',
      async (name) => {
        const response = await put(name, NEW_HOOK);

        expect(response.status).toBe(409);
        expect(response.body).toStrictEqual({
          error:
            'Cannot write section "notification": the following keys are set by the environment ' +
            `and would not take effect: ${HOOK_KEY}`,
        });
        expectAudit(
          'error',
          `Wrote configuration section "notification": refused (env-sourced keys: ${HOOK_KEY})`,
        );
        expectFileUntouched();
      },
    );

    test.each([
      ['notification_discord_myhook', { url: NEW_URL }],
      ['NOTIFICATION_DISCORD_MYHOOK', { url: NEW_URL }],
      [' notification_discord_myhook ', { url: NEW_URL }],
      ['notification_discord', { myhook: { url: NEW_URL } }],
    ])('cannot reach the key through %j either: 400, nothing written', async (name, body) => {
      const response = await put(name, body);

      expect(response.status).toBe(400);
      expectFileUntouched();
    });

    test('refuses a _file body for the same key with the same 409', async () => {
      const response = await put('notification', secretFileHook());

      expect(response.status).toBe(409);
      expect(response.body).toStrictEqual({
        error:
          'Cannot write section "notification": the following keys are set by the environment ' +
          `and would not take effect: ${HOOK_KEY}`,
      });
      expectContract('409', response.body);
      expectAudit(
        'error',
        `Wrote configuration section "notification": refused (env-sourced keys: ${HOOK_KEY})`,
      );
      expectFileUntouched();
    });
  });

  describe('with the key set by the environment as a secret file', () => {
    beforeEach(() => {
      const envSecretPath = path.join(directory, 'env-secret');
      fs.writeFileSync(envSecretPath, 'https://env-secret.example/hook\n', { mode: 0o600 });
      vi.stubEnv(`${HOOK_KEY}__FILE`, envSecretPath);
      ddEnvVars[HOOK_KEY] = 'https://env-secret.example/hook';
      configFileSources[`${HOOK_KEY}__FILE`] = 'env';
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    test.each([
      ['a literal', () => NEW_HOOK],
      ['a _file', secretFileHook],
    ])('refuses %s body with 409, naming the key', async (_, body) => {
      const response = await put('notification', body());

      expect(response.status).toBe(409);
      expect(response.body).toStrictEqual({
        error:
          'Cannot write section "notification": the following keys are set by the environment ' +
          `and would not take effect: ${HOOK_KEY}`,
      });
      expectContract('409', response.body);
      expectFileUntouched();
    });
  });

  test('writes a _file body for a key the environment does not set and reports the key', async () => {
    const response = await put('notification', secretFileHook());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      applied: true,
      section: 'notification',
      changedKeys: [HOOK_KEY],
      restartRequired: false,
    });
    expectContract('200', response.body);
    expectAudit('info', 'Wrote configuration section "notification": 1 key(s) changed');
    expect(yaml.parse(fs.readFileSync(configPath, 'utf8')).notification).toStrictEqual(
      secretFileHook(),
    );
  });

  describe('from a session that signed in with a recovery code', () => {
    const recovery = { 'X-Test-Principal': 'recovery' };

    test.each([
      ['auth', NEW_ACCOUNT],
      ['AUTH', NEW_ACCOUNT],
      [' auth ', NEW_ACCOUNT],
      ['auth_basic_eve', { user: 'eve', hash: HASH }],
      ['auth_totp', { allowhttp: true }],
    ])(
      'is refused the authentication section, spelled %j, before the engine sees it',
      async (name, body) => {
        const response = await put(name, body, recovery);

        expect(response.status).toBe(403);
        expect(response.body).toStrictEqual({
          error:
            'A session that signed in with a recovery code cannot change the authentication configuration. Sign in with a code from your authenticator app and try again.',
          details: { reason: 'recovery-assurance' },
        });
        expectContract('403', response.body);
        expect(audit).not.toHaveBeenCalled();
        expectFileUntouched();
      },
    );

    test('still writes a section that is not authentication', async () => {
      const response = await put('notification', NEW_HOOK, recovery);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ section: 'notification', changedKeys: [HOOK_KEY] });
    });
  });
});
