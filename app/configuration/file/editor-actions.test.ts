import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { validateOpenApiJsonResponse } from '../../api/openapi-contract.js';
import type Component from '../../registry/Component.js';
import {
  applySharedTriggerConfigurationByName,
  applyTriggerGroupDefaults,
} from '../../registry/trigger-shared-config.js';
import Command from '../../triggers/providers/command/Command.js';
import Docker from '../../triggers/providers/docker/Docker.js';
import Dockercompose from '../../triggers/providers/dockercompose/Dockercompose.js';
import Portainer from '../../triggers/providers/portainer/Portainer.js';
import {
  configFileInterpolatedKeys,
  configFileSources,
  ddEnvVars,
  getTriggerConfigurations,
} from '../index.js';
import {
  getActionEditSnapshot,
  getNotificationTriggerEditSnapshot,
  getWatcherEditSnapshot,
  writeActionEdits,
  writeNotificationTriggerEdits,
  writeWatcherEdits,
} from './editor.js';
import { resetConfigFileLayer, setConfigFileLayer } from './layer.js';
import { writeConfigurationSection } from './write.js';

interface ActionRow {
  type: string;
  name: string;
  agent?: string;
  configuration: Record<string, unknown>;
}
const { state, reload } = vi.hoisted(() => ({
  state: { trigger: {} as Record<string, ActionRow>, watcher: {} as Record<string, unknown> },
  reload: vi.fn(),
}));
vi.mock('../../registry/index.js', () => ({ getState: () => state }));
vi.mock('./reload.js', () => ({ reloadConfiguration: reload }));

describe('action policy editor', () => {
  let directory: string;
  let configPath: string;
  let previous: typeof ddEnvVars;
  let sources: typeof configFileSources;
  let interpolated: Set<string>;
  beforeEach(() => {
    vi.clearAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-action-editor-'));
    configPath = path.join(directory, 'drydock.yml');
    previous = { ...ddEnvVars };
    sources = { ...configFileSources };
    interpolated = new Set(configFileInterpolatedKeys);
    configFileInterpolatedKeys.clear();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    state.trigger = {
      'docker.private': {
        type: 'docker',
        name: 'private',
        configuration: { auto: 'oninclude', order: 100 },
      },
    };
    state.watcher = {};
    reload.mockResolvedValue({ applied: true, errors: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(ddEnvVars, previous);
    Object.assign(configFileSources, sources);
    configFileInterpolatedKeys.clear();
    for (const key of interpolated) configFileInterpolatedKeys.add(key);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function fixture(raw = 'action:\n  docker:\n    private: {}\n') {
    fs.writeFileSync(configPath, raw, { mode: 0o600 });
    setConfigFileLayer({}, new Set(), { path: configPath, modifiedAt: new Date().toISOString() });
  }
  async function edit(field: string, value: unknown) {
    const snapshot = await getActionEditSnapshot();
    return writeActionEdits({
      revision: snapshot.revision,
      changes: [{ path: ['action', 'docker', 'private', field], operation: 'set', value }],
    });
  }

  test.each(['docker', 'dockercompose', 'portainer', 'command'] as const)(
    'uses the real %s schema and validated defaults without executing it',
    async (type) => {
      const constructors = {
        docker: Docker,
        dockercompose: Dockercompose,
        portainer: Portainer,
        command: Command,
      };
      const component: Component = new constructors[type]();
      component.type = type;
      component.name = 'private';
      const options =
        type === 'command'
          ? { cmd: 'echo private-command' }
          : type === 'portainer'
            ? { url: 'https://portainer.example', apikey: 'private-credential' }
            : {};
      const rawOptions = Object.fromEntries(Object.entries(options));
      const init = vi.spyOn(component, 'init');
      fixture(yaml.stringify({ action: { [type]: { private: rawOptions } } }));
      state.trigger = {
        [`${type}.private`]: {
          type,
          name: 'private',
          configuration: component.validateConfiguration(options),
        },
      };
      const snapshot = await getActionEditSnapshot();
      expect(snapshot.actions[0].fields).toMatchObject({
        auto: { source: 'default', effectiveValue: 'oninclude' },
        order: { effectiveValue: 100 },
        concurrency: { effectiveValue: 1 },
      });
      for (const auto of [false, true, 'OnAuto', 'ONINCLUDE', 'none', 'all']) {
        const current = await getActionEditSnapshot();
        const result = await writeActionEdits({
          revision: current.revision,
          changes: [
            { path: ['action', type, 'private', 'auto'], operation: 'set', value: auto },
            { path: ['action', type, 'private', 'order'], operation: 'set', value: -3.5 },
            { path: ['action', type, 'private', 'concurrency'], operation: 'set', value: 2 },
          ],
        });
        expect(result).toMatchObject({ saved: true, applied: true });
        const saved = yaml.parse(fs.readFileSync(configPath, 'utf8')).action[type].private;
        const validated = component.validateConfiguration(saved);
        expect(validated).toMatchObject({
          auto: auto === false ? 'none' : auto === true ? 'all' : auto.toLowerCase(),
          order: -3.5,
          concurrency: 2,
        });
      }
      expect(init).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshot)).not.toMatch(
        /private-command|private-credential|portainer.example/,
      );
    },
  );

  test('resolves inherited concurrency and explicit removal without inventing a default', async () => {
    fixture('action:\n  docker:\n    private:\n      concurrency: 3\n');
    state.trigger['docker.private'].configuration.concurrency = 3;
    ddEnvVars.DD_UPDATE_CONCURRENCY = '7';
    expect((await getActionEditSnapshot()).actions[0].fields.concurrency.effectiveValue).toBe(3);
    const before = await getActionEditSnapshot();
    expect(
      await writeActionEdits({
        revision: before.revision,
        changes: [{ path: ['action', 'docker', 'private', 'concurrency'], operation: 'remove' }],
      }),
    ).toMatchObject({ saved: true, applied: true });
    delete state.trigger['docker.private'].configuration.concurrency;
    expect((await getActionEditSnapshot()).actions[0].fields.concurrency).toMatchObject({
      source: 'default',
      present: false,
      effectiveValue: 7,
    });
  });

  test.each([
    'raw-interpolation',
    'raw-file',
    'raw-alias',
    'live-interpolation',
    'runtime-interpolation',
    'live-file',
    'environment-file',
    'ambiguous-section',
    'ambiguous-field',
    'aliased-section',
  ])('omits inherited reference values but keeps a local override editable: %s', async (kind) => {
    ddEnvVars.DD_UPDATE_CONCURRENCY = '923';
    const raw =
      kind === 'raw-interpolation'
        ? 'update:\n  concurrency: ${PRIVATE_LIMIT}\n'
        : kind === 'raw-file'
          ? 'update:\n  concurrency:\n    _file: /private/credential\n'
          : kind === 'raw-alias'
            ? 'action:\n  docker:\n    private:\n      order: &limit 923\nupdate:\n  concurrency: *limit\n'
            : '';
    fixture(raw + (kind === 'raw-alias' ? '' : 'action:\n  docker:\n    private: {}\n'));
    if (kind === 'ambiguous-section')
      fixture(
        'update: { concurrency: 923 }\nUpdate: { concurrency: 2 }\naction: { docker: { private: {} } }\n',
      );
    if (kind === 'ambiguous-field')
      fixture(
        'update: { concurrency: 923, Concurrency: 2 }\naction: { docker: { private: {} } }\n',
      );
    if (kind === 'aliased-section')
      fixture('action: { docker: { private: &settings {} } }\nupdate: *settings\n');
    if (kind === 'live-interpolation' || kind === 'live-file')
      setConfigFileLayer(
        kind === 'live-file' ? { DD_UPDATE_CONCURRENCY__FILE: '/private/credential' } : {},
        new Set(kind === 'live-interpolation' ? ['DD_UPDATE_CONCURRENCY'] : []),
        { path: configPath, modifiedAt: new Date().toISOString() },
      );
    if (kind === 'runtime-interpolation') configFileInterpolatedKeys.add('DD_UPDATE_CONCURRENCY');
    if (kind === 'environment-file')
      vi.stubEnv('DD_UPDATE_CONCURRENCY__FILE', '/private/credential');
    const field = (await getActionEditSnapshot()).actions[0].fields.concurrency;
    expect(field.path).toEqual(['action', 'docker', 'private', 'concurrency']);
    expect(field.effectiveValue).toBeUndefined();
    expect(JSON.stringify(field)).not.toMatch(/923|PRIVATE_LIMIT|credential/);
    state.trigger['docker.private'].configuration.concurrency = 3;
    expect((await getActionEditSnapshot()).actions[0].fields.concurrency.effectiveValue).toBe(3);
  });

  test.each([
    'defaults: &policy {auto: all, order: 923, concurrency: 4}\naction: {docker: {private: *policy}}\n',
    'defaults: &provider {private: {auto: all, order: 923, concurrency: 4}}\naction: {docker: *provider}\n',
    'defaults: &section {docker: {private: {auto: all, order: 923, concurrency: 4}}}\naction: *section\n',
    'action: {docker: {private: {}}}\nAction: {docker: {private: {order: 923}}}\n',
    'action: {docker: {private: {}}, Docker: {private: {order: 923}}}\n',
    'action: {docker: {private: {}, Private: {order: 923}}}\n',
  ])('omits policy values beneath aliased or ambiguous parent paths: %s', async (raw) => {
    fixture(raw);
    state.trigger['docker.private'].configuration = { auto: 'all', order: 923, concurrency: 4 };
    const snapshot = await getActionEditSnapshot();
    for (const field of Object.values(snapshot.actions[0].fields)) {
      expect(field.path).toBeUndefined();
      expect(field.value).toBeUndefined();
      expect(field.effectiveValue).toBeUndefined();
    }
  });

  test.each(['file', 'interpolation'])(
    'omits inherited order from an unregistered env-only notification provider: %s',
    async (kind) => {
      fixture();
      ddEnvVars.DD_ACTION_DOCKER_PRIVATE_AUTO = 'oninclude';
      ddEnvVars.DD_NOTIFICATION_DISCORD_PRIVATE_ORDER = '923';
      ddEnvVars.DD_NOTIFICATION_DISCORD_PRIVATE_URL = 'not-a-valid-url';
      const shared = applySharedTriggerConfigurationByName(getTriggerConfigurations());
      expect(shared).toMatchObject({ docker: { private: { order: '923' } } });
      expect(state.trigger['discord.private']).toBeUndefined();
      state.trigger['docker.private'].configuration.order = 923;
      if (kind === 'file')
        vi.stubEnv('DD_NOTIFICATION_DISCORD_PRIVATE_ORDER__FILE', '/private/credential');
      else configFileInterpolatedKeys.add('DD_NOTIFICATION_DISCORD_PRIVATE_ORDER');
      expect(
        (await getActionEditSnapshot()).actions[0].fields.order.effectiveValue,
      ).toBeUndefined();
    },
  );

  test('an ordinary global scalar does not hide the inherited limit', async () => {
    fixture('update: { concurrency: 7 }\naction: { docker: { private: {} } }\n');
    ddEnvVars.DD_UPDATE_CONCURRENCY = '7';
    expect((await getActionEditSnapshot()).actions[0].fields.concurrency.effectiveValue).toBe(7);
  });

  test('ignores non-string provider keys in an externally edited file', async () => {
    fixture('action: {docker: {private: {}}, 42: {order: 923}}\n');
    expect((await getActionEditSnapshot()).actions[0].fields.order.effectiveValue).toBe(100);
  });

  test.each(['peer', 'provider', 'group'] as const)(
    'omits reference-derived order inherited from a %s without changing precedence',
    async (kind) => {
      const raw =
        kind === 'peer'
          ? 'action: { docker: { private: {} } }\nnotification: { discord: { private: { url: https://discord.example/private, order: "${PRIVATE_ORDER}" } } }\n'
          : kind === 'provider'
            ? 'action: { docker: { private: {}, order: "${PRIVATE_ORDER}" } }\n'
            : 'action: { docker: { private: {} }, private: { order: "${PRIVATE_ORDER}" } }\n';
      fixture(raw);
      const shared =
        kind === 'group'
          ? applyTriggerGroupDefaults(
              { docker: { private: {} }, private: { order: 923 } },
              new Set(['docker']),
            )
          : applySharedTriggerConfigurationByName(
              kind === 'peer'
                ? { docker: { private: {} }, discord: { private: { order: 923 } } }
                : { docker: { private: {}, order: 923 } },
            );
      expect(shared).toMatchObject({ docker: { private: { order: 923 } } });
      state.trigger['docker.private'].configuration.order = 923;
      state.trigger['discord.private'] = {
        type: 'discord',
        name: 'private',
        configuration: { order: 923 },
      };
      const field = (await getActionEditSnapshot()).actions[0].fields.order;
      expect(field.path).toEqual(['action', 'docker', 'private', 'order']);
      expect(field.effectiveValue).toBeUndefined();
      fixture(raw.replace('private: {}', 'private: { order: 12 }'));
      state.trigger['docker.private'].configuration.order = 12;
      expect((await getActionEditSnapshot()).actions[0].fields.order.effectiveValue).toBe(12);
    },
  );

  test.each([
    'env',
    'source-env',
    'file-ref',
    'interpolation',
    'alias',
    'ambiguous',
    'live-file',
    'env-file',
    'live-interpolation',
    'runtime-interpolation',
  ])('refuses source-owned action leaves and omits reference values: %s', async (kind) => {
    const value =
      kind === 'file-ref'
        ? '{ _file: /private/credential }'
        : kind === 'interpolation'
          ? '${PRIVATE_AUTO}'
          : kind === 'alias'
            ? '*value'
            : 'oninclude';
    fixture(
      `action:\n  docker:\n    private:\n      order: &value 923\n      auto: ${value}\n${kind === 'ambiguous' ? '      Auto: none\n' : ''}`,
    );
    if (kind === 'env') vi.stubEnv('DD_ACTION_DOCKER_PRIVATE_AUTO', 'none');
    if (kind === 'source-env') configFileSources.DD_ACTION_DOCKER_PRIVATE_AUTO = 'env';
    if (kind === 'env-file')
      vi.stubEnv('DD_ACTION_DOCKER_PRIVATE_AUTO__FILE', '/private/credential');
    if (kind === 'live-file' || kind === 'live-interpolation')
      setConfigFileLayer(
        kind === 'live-file' ? { DD_ACTION_DOCKER_PRIVATE_AUTO__FILE: '/private/credential' } : {},
        new Set(kind === 'live-interpolation' ? ['DD_ACTION_DOCKER_PRIVATE_AUTO'] : []),
        { path: configPath, modifiedAt: new Date().toISOString() },
      );
    if (kind === 'runtime-interpolation')
      configFileInterpolatedKeys.add('DD_ACTION_DOCKER_PRIVATE_AUTO');
    const snapshot = await getActionEditSnapshot();
    const field = snapshot.actions[0].fields.auto;
    expect(field.path).toBeUndefined();
    if (!['env', 'source-env'].includes(kind)) {
      expect(field.value).toBeUndefined();
      expect(field.effectiveValue).toBeUndefined();
    }
    const before = fs.readFileSync(configPath, 'utf8');
    expect(await edit('auto', false)).toMatchObject({ status: 409, saved: false });
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    expect(reload).not.toHaveBeenCalled();
  });

  test('keeps exact identities, excludes notifications and refuses absent or ambiguous instances', async () => {
    fixture(
      'action:\n  docker:\n    private: {}\n  command:\n    private: { cmd: harmless }\nnotification:\n  discord:\n    private: { url: https://discord.example/private }\n',
    );
    state.trigger['command.private'] = {
      type: 'command',
      name: 'private',
      configuration: { auto: 'oninclude' },
    };
    state.trigger['edge.docker.private'] = {
      ...state.trigger['docker.private'],
      agent: 'Local',
      configuration: { auto: 'remote-secret' },
    };
    state.trigger['docker.missing'] = { ...state.trigger['docker.private'], name: 'missing' };
    state.trigger['discord.private'] = {
      type: 'discord',
      name: 'private',
      configuration: { auto: 'notification-secret' },
    };
    const snapshot = await getActionEditSnapshot();
    expect(snapshot.actions.map(({ id }) => id)).toEqual([
      'docker.private',
      'command.private',
      'edge.docker.private',
      'docker.missing',
    ]);
    expect(snapshot.actions[2].fields.auto).toEqual({
      present: false,
      source: 'default',
      readOnlyReason: 'agent-trigger',
    });
    expect(snapshot.actions[3].fields.auto.readOnlyReason).toBe('trigger-not-in-file');
    expect(JSON.stringify(snapshot)).not.toMatch(/remote-secret|notification-secret|harmless/);
    for (const raw of [
      'action: { docker: { private: {}, Private: {} } }',
      'action: { docker: { private: {} }, Docker: { private: {} } }',
      'action: { docker: { private: {} } }\nAction: { docker: { private: {} } }',
    ]) {
      fixture(raw);
      expect((await getActionEditSnapshot()).actions[0].fields.auto.path).toBeUndefined();
    }
  });

  test('missing files are unavailable, never created, and edits fail without a write', async () => {
    expect(await getActionEditSnapshot()).toMatchObject({
      available: false,
      readOnlyReason: 'configuration-file-unavailable',
    });
    expect(
      await writeActionEdits({
        revision: 'a'.repeat(43),
        changes: [
          { path: ['action', 'docker', 'private', 'auto'], operation: 'set', value: false },
        ],
      }),
    ).toMatchObject({ status: 409, saved: false });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  test.each([
    ['concurrency', 0],
    ['concurrency', -1],
    ['concurrency', 1.5],
    ['concurrency', 'wrong'],
    ['auto', 'wrong'],
    ['order', 'wrong'],
  ])('rejects invalid %s=%s with real Joi and unchanged bytes', async (field, value) => {
    fixture();
    const raw = fs.readFileSync(configPath, 'utf8');
    expect(await edit(String(field), value)).toMatchObject({ status: 400, saved: false });
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    expect(reload).not.toHaveBeenCalled();
  });

  test('rejects malformed and forbidden changes, including other editor categories', async () => {
    fixture();
    expect(await writeActionEdits({})).toMatchObject({
      status: 400,
      saved: false,
      errors: [{ message: 'Invalid action policy edit request' }],
    });
    const snapshot = await getActionEditSnapshot();
    for (const target of [
      ['action', 'docker', 'private', 'mode'],
      ['notification', 'discord', 'private', 'auto'],
      ['watcher', 'local', 'cron'],
      ['action', 'docker', 'other', 'order'],
    ]) {
      expect(
        await writeActionEdits({
          revision: snapshot.revision,
          changes: [{ path: target, operation: 'set', value: 'simple' }],
        }),
      ).toMatchObject({ status: 409, saved: false });
    }
    expect(reload).not.toHaveBeenCalled();
  });

  test('rechecks stale revisions before writing and after asynchronous secret resolution', async () => {
    const credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'private-credential', { mode: 0o600 });
    fixture(
      `action: { docker: { private: {} } }\nregistry:\n  hub:\n    private:\n      login: reader\n      password:\n        _file: ${credentialPath}\n`,
    );
    const snapshot = await getActionEditSnapshot();
    const request = {
      revision: snapshot.revision,
      changes: [{ path: ['action', 'docker', 'private', 'auto'], operation: 'set', value: false }],
    };
    const open = fs.promises.open;
    vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => {
      fs.appendFileSync(configPath, '# external edit\n');
      return open(...args);
    });
    expect(await writeActionEdits(request)).toMatchObject({ status: 409, saved: false });
    expect(await writeActionEdits(request)).toMatchObject({ status: 409, saved: false });
    expect(fs.readFileSync(configPath, 'utf8')).toContain('# external edit');
    expect(reload).not.toHaveBeenCalled();
  });

  test.each(['refused', 'reconcile', 'throw'])(
    'reports a saved but unapplied %s reload without secret diagnostics',
    async (kind) => {
      fixture();
      if (kind === 'throw') reload.mockRejectedValueOnce(new Error('private-sentinel'));
      else
        reload.mockResolvedValueOnce({
          applied: kind === 'reconcile',
          errors: ['private-sentinel'],
          reconcile: {
            added: [],
            changed: [],
            removed: [],
            unchanged: [],
            errors: ['private-sentinel'],
          },
        });
      const result = await edit('auto', false);
      expect(result).toMatchObject({ saved: true, applied: false });
      expect(JSON.stringify(result)).not.toContain('private-sentinel');
    },
  );

  test('sanitizes failures before the write', async () => {
    fixture('private-sentinel: [');
    const { status, ...outcome } = await writeActionEdits({
      revision: 'a'.repeat(43),
      changes: [{ path: ['action', 'docker', 'private', 'auto'], operation: 'set', value: false }],
    });
    expect({ status, ...outcome }).toMatchObject({
      status: 500,
      saved: false,
      errors: [{ message: 'Unable to save action policy configuration' }],
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/actions',
        method: 'patch',
        statusCode: String(status),
        payload: outcome,
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  test.each(['watchers', 'triggers', 'legacy'] as const)(
    'shares the %s write queue without overwriting a concurrent edit',
    async (other) => {
      fixture(
        'action: { docker: { private: {} } }\nwatcher: { local: {} }\nnotification: { discord: { private: { url: https://discord.example/private } } }\n',
      );
      state.watcher = { 'docker.local': { name: 'local', configuration: {} } };
      state.trigger['discord.private'] = { type: 'discord', name: 'private', configuration: {} };
      const action = await getActionEditSnapshot();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      reload.mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return { applied: true };
      });
      const watcher = await getWatcherEditSnapshot();
      const notification = await getNotificationTriggerEditSnapshot();
      const first =
        other === 'watchers'
          ? writeWatcherEdits({
              revision: watcher.revision,
              changes: [
                { path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 0 * * *' },
              ],
            })
          : other === 'triggers'
            ? writeNotificationTriggerEdits({
                revision: notification.revision,
                changes: [
                  {
                    path: ['notification', 'discord', 'private', 'once'],
                    operation: 'set',
                    value: false,
                  },
                ],
              })
            : writeConfigurationSection('action', { docker: { private: { auto: 'none' } } });
      try {
        await started.promise;
        const second = writeActionEdits({
          revision: action.revision,
          changes: [{ path: ['action', 'docker', 'private', 'order'], operation: 'set', value: 2 }],
        });
        release.resolve();
        expect(await first).toMatchObject(
          other === 'legacy' ? { kind: 'written' } : { saved: true },
        );
        expect(await second).toMatchObject({ status: 409, saved: false });
        expect(
          yaml.parse(fs.readFileSync(configPath, 'utf8')).action.docker.private.order,
        ).toBeUndefined();
      } finally {
        release.resolve();
        await first;
      }
    },
  );
});
