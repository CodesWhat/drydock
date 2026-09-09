import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { validateOpenApiJsonResponse } from '../../api/openapi-contract.js';
import Discord from '../../triggers/providers/discord/Discord.js';
import { configFileSources, ddEnvVars } from '../index.js';
import {
  getNotificationTriggerEditSnapshot,
  getWatcherEditSnapshot,
  writeNotificationTriggerEdits,
  writeWatcherEdits,
} from './editor.js';
import { resetConfigFileLayer, setConfigFileLayer } from './layer.js';
import { writeConfigurationSection } from './write.js';

const { mockState, mockReload } = vi.hoisted(() => ({
  mockState: { watcher: {} as Record<string, unknown>, trigger: {} as Record<string, unknown> },
  mockReload: vi.fn(),
}));
vi.mock('../../registry/index.js', () => ({ getState: () => mockState }));
vi.mock('./reload.js', () => ({ reloadConfiguration: () => mockReload() }));

describe('notification policy editor', () => {
  let directory: string;
  let configPath: string;
  let current: typeof ddEnvVars;
  let sources: typeof configFileSources;

  beforeEach(() => {
    vi.clearAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-notification-editor-'));
    configPath = path.join(directory, 'drydock.yml');
    current = { ...ddEnvVars };
    sources = { ...configFileSources };
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    mockState.trigger = {
      'discord.private': {
        type: 'discord',
        name: 'private',
        configuration: {
          threshold: 'all',
          once: true,
          mode: 'simple',
          securitymode: 'simple',
          digestcron: '0 8 * * *',
          resolvenotifications: false,
        },
      },
    };
    mockState.watcher = {};
    mockReload.mockResolvedValue({
      applied: true,
      errors: [],
      diff: { changed: [], reload: [], restart: [] },
      reconcile: { added: [], changed: [], removed: [], unchanged: [], errors: [] },
      orphanedRules: [],
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(ddEnvVars, current);
    Object.assign(configFileSources, sources);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function fixture(raw: string) {
    fs.writeFileSync(configPath, raw, { mode: 0o600 });
    setConfigFileLayer({}, new Set(), { path: configPath, modifiedAt: new Date().toISOString() });
  }

  test('edits all six policy fields while retaining credentials, references, destinations and comments', async () => {
    const credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'file-private-sentinel', { mode: 0o600 });
    const raw =
      '# preserve comment\nNotification:\n  Discord:\n    Private:\n      url: https://discord.example/private-sentinel\n      threshold: all # threshold\nRegistry:\n  hub:\n    private:\n      login: ${REGISTRY_LOGIN:-reader}\n      password:\n        _file: ' +
      credentialPath +
      '\n';
    fixture(raw);
    const snapshot = await getNotificationTriggerEditSnapshot();
    expect(snapshot.available).toBe(true);
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/triggers',
        method: 'get',
        statusCode: '200',
        payload: snapshot,
      }),
    ).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(snapshot)).not.toMatch(/private-sentinel|REGISTRY_LOGIN|credential/);
    const values = {
      threshold: 'patch-no-digest',
      once: false,
      mode: 'digest',
      securitymode: 'batch+digest',
      digestcron: '0 9 * * *',
      resolvenotifications: true,
    };
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: Object.entries(values).map(([field, value]) => ({
        path: ['Notification', 'Discord', 'Private', field],
        operation: 'set',
        value,
      })),
    });
    expect(result).toMatchObject({ status: 200, saved: true, applied: true });
    const { status, ...payload } = result;
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/triggers',
        method: 'patch',
        statusCode: String(status),
        payload,
      }),
    ).toEqual({ valid: true, errors: [] });
    const saved = fs.readFileSync(configPath, 'utf8');
    expect(yaml.parse(saved).Notification.Discord.Private).toEqual({
      url: 'https://discord.example/private-sentinel',
      ...values,
    });
    expect(yaml.parse(saved).Registry).toEqual(yaml.parse(raw).Registry);
    expect(saved).toContain('# preserve comment');
    expect(saved).toContain('# threshold');
    expect(result.revision).not.toBe(snapshot.revision);
  });

  test('does not initialize or send notifications during real candidate validation', async () => {
    fixture(
      'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n',
    );
    const initialize = vi.spyOn(Discord.prototype, 'initTrigger');
    const register = vi.spyOn(Discord.prototype, 'register');
    const send = vi.spyOn(Discord.prototype, 'trigger');
    const batch = vi.spyOn(Discord.prototype, 'triggerBatch');
    const snapshot = await getNotificationTriggerEditSnapshot();
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [
        {
          path: ['notification', 'discord', 'private', 'threshold'],
          operation: 'set',
          value: 'minor',
        },
      ],
    });
    expect(result.saved).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  test('reports default and explicit values with exact provider and instance identity', async () => {
    fixture(
      'Notification:\n  Discord:\n    Private:\n      url: https://discord.example/private\n      Once: false\n  Telegram:\n    Private:\n      threshold: minor\n',
    );
    mockState.trigger['telegram.private'] = {
      type: 'telegram',
      name: 'private',
      configuration: { threshold: 'minor' },
    };
    const rows = (await getNotificationTriggerEditSnapshot()).triggers;
    expect(rows[0]).toMatchObject({
      id: 'discord.private',
      type: 'discord',
      name: 'private',
      category: 'notification',
    });
    expect(rows[0].fields.once).toMatchObject({
      present: true,
      value: false,
      source: 'file',
      path: ['Notification', 'Discord', 'Private', 'Once'],
    });
    expect(rows[0].fields.threshold).toMatchObject({
      present: false,
      effectiveValue: 'all',
      source: 'default',
    });
    expect(rows[1].fields.threshold.path).toEqual([
      'Notification',
      'Telegram',
      'Private',
      'threshold',
    ]);
  });

  test('omits actions and makes agent and missing-file instances read-only', async () => {
    fixture('notification:\n  discord:\n    private:\n      threshold: all\n');
    mockState.trigger['docker.local'] = { type: 'docker', name: 'local', configuration: {} };
    mockState.trigger['edge.discord.private'] = {
      type: 'discord',
      name: 'private',
      agent: 'edge',
      configuration: { threshold: 'private-sentinel' },
    };
    mockState.trigger['slack.absent'] = { type: 'slack', name: 'absent', configuration: {} };
    const snapshot = await getNotificationTriggerEditSnapshot();
    expect(snapshot.triggers.map(({ id }) => id)).toEqual([
      'discord.private',
      'edge.discord.private',
      'slack.absent',
    ]);
    expect(snapshot.triggers[1].fields.threshold).toEqual({
      present: true,
      source: 'file',
      readOnlyReason: 'agent-trigger',
    });
    expect(snapshot.triggers[2].fields.threshold.readOnlyReason).toBe('trigger-not-in-file');
    expect(JSON.stringify(snapshot)).not.toContain('private-sentinel');
  });

  test('reports MQTT mode as provider-forced and refuses to edit it', async () => {
    fixture('notification:\n  mqtt:\n    private:\n      mode: digest\n');
    mockState.trigger = {
      'mqtt.private': { type: 'mqtt', name: 'private', configuration: { mode: 'simple' } },
    };
    const snapshot = await getNotificationTriggerEditSnapshot();
    expect(snapshot.triggers[0].fields.mode).toEqual({
      present: true,
      source: 'file',
      readOnlyReason: 'provider-forced',
      value: 'digest',
      effectiveValue: 'simple',
    });
    expect(
      (
        await writeNotificationTriggerEdits({
          revision: snapshot.revision,
          changes: [
            { path: ['notification', 'mqtt', 'private', 'mode'], operation: 'set', value: 'batch' },
          ],
        })
      ).status,
    ).toBe(409);
    expect(mockReload).not.toHaveBeenCalled();
  });

  test.each(['environment', 'reference', 'alias', 'ambiguous', 'old-reference'])(
    'refuses an unavailable %s field without value disclosure',
    async (kind) => {
      const base =
        'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n';
      fixture(
        base +
          (kind === 'reference'
            ? '      threshold:\n        _file: /private/credential\n'
            : kind === 'alias'
              ? '      once: &value true\n      threshold: *value\n'
              : kind === 'ambiguous'
                ? '      threshold: all\n      Threshold: minor\n'
                : '      threshold: all\n'),
      );
      if (kind === 'environment') vi.stubEnv('DD_NOTIFICATION_DISCORD_PRIVATE_THRESHOLD', 'minor');
      if (kind === 'old-reference')
        setConfigFileLayer(
          { DD_NOTIFICATION_DISCORD_PRIVATE_THRESHOLD__FILE: '/private/credential' },
          new Set(),
          { path: configPath, modifiedAt: new Date().toISOString() },
        );
      const snapshot = await getNotificationTriggerEditSnapshot();
      expect(snapshot.triggers[0].fields.threshold.path).toBeUndefined();
      expect(JSON.stringify(snapshot)).not.toContain('/private/credential');
      const raw = fs.readFileSync(configPath, 'utf8');
      expect(
        (
          await writeNotificationTriggerEdits({
            revision: snapshot.revision,
            changes: [
              {
                path: ['notification', 'discord', 'private', 'threshold'],
                operation: 'set',
                value: 'patch',
              },
            ],
          })
        ).status,
      ).toBe(409);
      expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    },
  );

  test('omits interpolated and environment secret-file values', async () => {
    fixture('notification:\n  discord:\n    private:\n      threshold: ${PRIVATE_THRESHOLD}\n');
    vi.stubEnv('DD_NOTIFICATION_DISCORD_PRIVATE_DIGESTCRON__FILE', '/private/schedule');
    const snapshot = await getNotificationTriggerEditSnapshot();
    expect(snapshot.triggers[0].fields.threshold).toEqual({
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    });
    expect(snapshot.triggers[0].fields.digestcron).toEqual({
      present: false,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_THRESHOLD|private\/schedule/);
  });

  test('omits values when case-colliding policy aliases include a secret reference', async () => {
    fixture(
      'notification:\n  discord:\n    private:\n      threshold: all\n      Threshold:\n        _file: /private/credential\n',
    );
    const field = (await getNotificationTriggerEditSnapshot()).triggers[0].fields.threshold;
    expect(field.readOnlyReason).toBe('ambiguous-field-alias');
    expect(field.value).toBeUndefined();
    expect(field.effectiveValue).toBeUndefined();
  });

  test.each([
    ['threshold', 'invalid'],
    ['digestcron', 'invalid'],
    ['mode', 'invalid'],
    ['securitymode', 'invalid'],
    ['once', 'invalid'],
    ['resolvenotifications', 'invalid'],
  ])('refuses invalid %s before saving', async (field, value) => {
    fixture(
      'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n',
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    const snapshot = await getNotificationTriggerEditSnapshot();
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [{ path: ['notification', 'discord', 'private', field], operation: 'set', value }],
    });
    expect(result.status).toBe(400);
    expect(result.saved).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    expect(mockReload).not.toHaveBeenCalled();
  });

  test('removes an explicit policy field without replacing other values', async () => {
    fixture(
      'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n      once: false\n',
    );
    const snapshot = await getNotificationTriggerEditSnapshot();
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [{ path: ['notification', 'discord', 'private', 'once'], operation: 'remove' }],
    });
    expect(result.saved).toBe(true);
    expect(yaml.parse(fs.readFileSync(configPath, 'utf8')).notification.discord.private).toEqual({
      url: 'https://discord.example/private',
    });
  });

  test('serializes cross-editor writes with one revision and refuses cross-editor paths', async () => {
    fixture(
      'watcher:\n  local:\n    cron: "0 */6 * * *"\nnotification:\n  discord:\n    private:\n      url: https://discord.example/private\n',
    );
    mockState.watcher = {
      'docker.local': { name: 'local', configuration: { cron: '0 */6 * * *' } },
    };
    const watcher = await getWatcherEditSnapshot();
    const notification = await getNotificationTriggerEditSnapshot();
    expect(notification.revision).toBe(watcher.revision);
    expect(
      (
        await writeNotificationTriggerEdits({
          revision: notification.revision,
          changes: [{ path: ['watcher', 'local', 'cron'], operation: 'remove' }],
        })
      ).status,
    ).toBe(409);
    const result = await Promise.all([
      writeWatcherEdits({
        revision: watcher.revision,
        changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
      }),
      writeNotificationTriggerEdits({
        revision: notification.revision,
        changes: [
          { path: ['notification', 'discord', 'private', 'once'], operation: 'set', value: false },
        ],
      }),
    ]);
    expect(result.map(({ status }) => status)).toEqual([200, 409]);
  });

  test('waits behind a legacy write and refuses its stale revision', async () => {
    fixture(
      'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n',
    );
    const snapshot = await getNotificationTriggerEditSnapshot();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockReload.mockImplementationOnce(async () => {
      entered();
      await pending;
      return { applied: true };
    });
    const legacy = writeConfigurationSection('notification', {
      discord: { private: { url: 'https://discord.example/private', once: false } },
    });
    await started;
    const edit = writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [
        {
          path: ['notification', 'discord', 'private', 'threshold'],
          operation: 'set',
          value: 'minor',
        },
      ],
    });
    release();
    await legacy;
    expect((await edit).status).toBe(409);
  });

  test('rechecks revision after secret I/O during validation', async () => {
    const credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'https://discord.example/private', { mode: 0o600 });
    fixture(
      `notification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n`,
    );
    const snapshot = await getNotificationTriggerEditSnapshot();
    const open = fs.promises.open;
    vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => {
      fs.appendFileSync(configPath, '# external edit\n');
      return open(...args);
    });
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [
        { path: ['notification', 'discord', 'private', 'once'], operation: 'set', value: false },
      ],
    });
    expect(result.status).toBe(409);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('# external edit');
  });

  test.each(['refused', 'reconcile', 'throw'])(
    'retains truthful saved state when reload is %s',
    async (failure) => {
      fixture(
        'notification:\n  discord:\n    private:\n      url: https://discord.example/private\n',
      );
      const snapshot = await getNotificationTriggerEditSnapshot();
      if (failure === 'throw') mockReload.mockRejectedValueOnce(new Error('private-sentinel'));
      else
        mockReload.mockResolvedValueOnce({
          applied: failure === 'reconcile',
          errors: ['private-sentinel'],
          reconcile:
            failure === 'reconcile'
              ? { added: [], changed: [], removed: [], unchanged: [], errors: ['private-sentinel'] }
              : undefined,
        });
      const result = await writeNotificationTriggerEdits({
        revision: snapshot.revision,
        changes: [
          { path: ['notification', 'discord', 'private', 'once'], operation: 'set', value: false },
        ],
      });
      expect(result).toMatchObject({ saved: true, applied: false });
      expect(result.revision).not.toBe(snapshot.revision);
      expect(JSON.stringify(result)).not.toContain('private-sentinel');
    },
  );

  test('reports its own invalid-request context and never creates a file', async () => {
    expect((await writeNotificationTriggerEdits({})).errors[0].message).toBe(
      'Invalid notification policy edit request',
    );
    expect((await getNotificationTriggerEditSnapshot()).available).toBe(false);
    expect(
      (
        await writeNotificationTriggerEdits({
          revision: 'a'.repeat(43),
          changes: [{ path: ['notification', 'discord', 'private', 'once'], operation: 'remove' }],
        })
      ).status,
    ).toBe(409);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  test('refuses an unreadable untouched secret before saving without returning its path', async () => {
    fixture(
      `notification:\n  discord:\n    private:\n      url:\n        _file: ${path.join(directory, 'private-sentinel')}\n`,
    );
    const snapshot = await getNotificationTriggerEditSnapshot();
    const raw = fs.readFileSync(configPath, 'utf8');
    const result = await writeNotificationTriggerEdits({
      revision: snapshot.revision,
      changes: [
        { path: ['notification', 'discord', 'private', 'once'], operation: 'set', value: false },
      ],
    });
    expect(result).toMatchObject({ status: 500, saved: false, applied: false });
    expect(result.revision).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private-sentinel');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    expect(mockReload).not.toHaveBeenCalled();
  });
});
