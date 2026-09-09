import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateOpenApiJsonResponse } from '../../api/openapi-contract.js';
import { configFileSources, ddEnvVars } from '../index.js';
import { getWatcherEditSnapshot, writeWatcherEdits } from './editor.js';
import { resetConfigFileLayer, setConfigFileLayer } from './layer.js';
import { writeConfigurationSection } from './write.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), rename: vi.fn(actual.rename) };
});

const { mockState, mockReload } = vi.hoisted(() => ({
  mockState: { watcher: {} as Record<string, unknown> },
  mockReload: vi.fn(),
}));
vi.mock('../../registry/index.js', () => ({ getState: () => mockState }));
vi.mock('./reload.js', () => ({
  reloadConfiguration: (...args: unknown[]) => mockReload(...args),
}));

describe('watcher configuration editor', () => {
  let directory: string;
  let configPath: string;
  let current: typeof ddEnvVars;
  let sources: typeof configFileSources;

  beforeEach(() => {
    vi.clearAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-editor-'));
    configPath = path.join(directory, 'drydock.yml');
    current = { ...ddEnvVars };
    sources = { ...configFileSources };
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    mockState.watcher = {
      'docker.local': {
        name: 'local',
        configuration: {
          cron: '0 */6 * * *',
          maintenancewindowtz: 'UTC',
          maintenancewindowscope: 'all',
        },
      },
    };
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

  test('changes only cron while preserving private values, file references, interpolation and comments', async () => {
    const credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'file-private-sentinel\n', { mode: 0o600 });
    const raw =
      '# keep this comment\nWatcher:\n  Local:\n    cron: "0 */6 * * *" # schedule\n    socket: /var/run/docker.sock\n' +
      'registry:\n  hub:\n    private:\n      login: reader\n      password: inline-private-sentinel\n' +
      `notification:\n  discord:\n    private:\n      url: \${WEBHOOK_URL:-https://discord.example/hook}\n  pushover:\n    private:\n      user:\n        _file: ${credentialPath}\n      token: provider-private-sentinel\n`;
    fixture(raw);
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.available).toBe(true);
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/watchers',
        method: 'get',
        statusCode: '200',
        payload: snapshot,
      }),
    ).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private-sentinel|WEBHOOK_URL|credential|docker.sock/,
    );
    const result = await writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['Watcher', 'Local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
    });
    expect(result.saved).toBe(true);
    expect(result.applied).toBe(true);
    const { status, ...payload } = result;
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/watchers',
        method: 'patch',
        statusCode: String(status),
        payload,
      }),
    ).toEqual({ valid: true, errors: [] });
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw.replace('0 */6 * * *', '0 */8 * * *'));
    expect(result.revision).not.toBe(snapshot.revision);
  });

  test('omits both values for referenced fields and refuses edits to them', async () => {
    fixture(
      'watcher:\n  local:\n    cron: ${PRIVATE_CRON}\n    maintenancewindow:\n      _file: /private/window\n',
    );
    (
      mockState.watcher['docker.local'] as { configuration: Record<string, unknown> }
    ).configuration = { cron: 'private-sentinel', maintenancewindow: 'file-private-sentinel' };
    const snapshot = await getWatcherEditSnapshot();
    expect(JSON.stringify(snapshot)).not.toMatch(/private-sentinel|PRIVATE_CRON|private\/window/);
    expect(snapshot.watchers[0].fields.cron).toEqual({
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    });
    const result = await writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '* * * * *' }],
    });
    expect(result.status).toBe(409);
    expect(result.saved).toBe(false);
  });

  test('does not reveal a still-live secret after an external edit replaces its reference on disk', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    setConfigFileLayer({ DD_WATCHER_LOCAL_CRON__FILE: '/private/credential' }, new Set(), {
      path: configPath,
      modifiedAt: new Date().toISOString(),
    });
    (
      mockState.watcher['docker.local'] as { configuration: Record<string, unknown> }
    ).configuration.cron = 'private-sentinel';
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.watchers[0].fields.cron.readOnlyReason).toBe('referenced-field');
    expect(JSON.stringify(snapshot)).not.toContain('private-sentinel');
    expect(snapshot.watchers[0].fields.cron.value).toBeUndefined();
  });

  test('environment maintenance aliases make the corresponding canonical field read-only', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    vi.stubEnv('DD_WATCHER_LOCAL_MAINTENANCE_WINDOW', '0 0 * * *');
    const field = (await getWatcherEditSnapshot()).watchers[0].fields.maintenancewindow;
    expect(field.readOnlyReason).toBe('environment-owned');
    expect(field.path).toBeUndefined();
  });

  test('unrelated same-watcher environment configuration does not block an editable cron', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    ddEnvVars.DD_WATCHER_LOCAL_SOCKET = '/private-sentinel/docker.sock';
    configFileSources.DD_WATCHER_LOCAL_SOCKET = 'env';
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.watchers[0].fields.cron.path).toEqual(['watcher', 'local', 'cron']);
    expect(JSON.stringify(snapshot)).not.toContain('private-sentinel');
    expect(
      (
        await writeWatcherEdits({
          revision: snapshot.revision,
          changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
        })
      ).saved,
    ).toBe(true);
  });

  test('refuses secret resolution failures before saving without returning paths or private data', async () => {
    fixture(
      `watcher:\n  local:\n    cron: "0 */6 * * *"\nregistry:\n  hub:\n    private:\n      login: reader\n      password:\n        _file: ${path.join(directory, 'private-sentinel')}\n`,
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    const snapshot = await getWatcherEditSnapshot();
    const result = await writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
    });
    expect(result).toMatchObject({ status: 500, saved: false, applied: false });
    expect(JSON.stringify(result)).not.toContain('private-sentinel');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    expect(mockReload).not.toHaveBeenCalled();
  });

  test('preserves exact maintenance aliases and unrelated watcher nodes when setting and removing', async () => {
    const raw =
      'Watcher:\n  Local:\n    cron: "0 */6 * * *"\n    maintenance_window: "0 0 * * *" # window\n    maintenance_window_tz: UTC\n    socket: /var/run/docker.sock\n';
    fixture(raw);
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.watchers[0].fields.maintenancewindow.path).toEqual([
      'Watcher',
      'Local',
      'maintenance_window',
    ]);
    expect(
      (
        await writeWatcherEdits({
          revision: snapshot.revision,
          changes: [
            {
              path: ['Watcher', 'Local', 'maintenance_window'],
              operation: 'set',
              value: '0 1 * * *',
            },
          ],
        })
      ).saved,
    ).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw.replace('0 0 * * *', '0 1 * * *'));
    const next = await getWatcherEditSnapshot();
    expect(
      (
        await writeWatcherEdits({
          revision: next.revision,
          changes: [{ path: ['Watcher', 'Local', 'maintenance_window_tz'], operation: 'remove' }],
        })
      ).saved,
    ).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('maintenance_window_tz');
  });

  test('does not change bytes for invalid cron or a stale revision', async () => {
    const raw = 'watcher:\n  local:\n    cron: "0 */6 * * *"\n';
    fixture(raw);
    const snapshot = await getWatcherEditSnapshot();
    const changes = [
      { path: ['watcher', 'local', 'cron'], operation: 'set', value: 'private-invalid-sentinel' },
    ];
    const invalid = await writeWatcherEdits({ revision: snapshot.revision, changes });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid)).not.toContain('private-invalid-sentinel');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    fs.appendFileSync(configPath, '# external change\n');
    expect((await writeWatcherEdits({ revision: snapshot.revision, changes })).status).toBe(409);
    expect(mockReload).not.toHaveBeenCalled();
  });

  test('serializes concurrent edits so only the first matching revision saves', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    const snapshot = await getWatcherEditSnapshot();
    const requests = ['0 */8 * * *', '0 */12 * * *'].map((value) =>
      writeWatcherEdits({
        revision: snapshot.revision,
        changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value }],
      }),
    );
    const outcomes = await Promise.all(requests);
    expect(outcomes.map(({ status }) => status)).toEqual([200, 409]);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('0 */8 * * *');
  });

  test.each(['refused', 'reconcile-error', 'throw'])(
    'reports saved but unapplied when reload is %s',
    async (failure) => {
      fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
      if (failure === 'throw') mockReload.mockRejectedValueOnce(new Error('private-sentinel'));
      else
        mockReload.mockResolvedValueOnce({
          applied: failure !== 'refused',
          errors: ['private-sentinel'],
          reconcile:
            failure === 'reconcile-error'
              ? { added: [], changed: [], removed: [], unchanged: [], errors: ['private-sentinel'] }
              : undefined,
        });
      const snapshot = await getWatcherEditSnapshot();
      const result = await writeWatcherEdits({
        revision: snapshot.revision,
        changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
      });
      expect(result.saved).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.revision).not.toBe(snapshot.revision);
      expect(JSON.stringify(result)).not.toContain('private-sentinel');
    },
  );

  test.each([
    null,
    'invalid',
    {},
    { revision: 7 },
    { revision: 'x', changes: [] },
    { revision: 'a'.repeat(43), changes: [] },
    { revision: 'a'.repeat(43), changes: Array(33).fill({}) },
    { revision: 'a'.repeat(43), changes: [null] },
    { revision: 'a'.repeat(43), changes: [{}] },
  ])('refuses malformed request %#', async (request) => {
    expect((await writeWatcherEdits(request)).status).toBe(400);
  });

  test.each([
    { path: null, operation: 'set', value: 'x' },
    { path: ['watcher', 'local'], operation: 'remove' },
    { path: ['watcher', 'local', 'a', 'b', 'c', 'd'], operation: 'remove' },
    { path: ['watcher', 'local', 7], operation: 'remove' },
    { path: ['watcher', 'local', 'bad.path'], operation: 'remove' },
    { path: ['watcher', 'local', '__proto__'], operation: 'remove' },
    { path: ['watcher', 'local', 'cron'], operation: 'set', value: {} },
    { path: ['watcher', 'local', 'cron'], operation: 'set', value: Number.NaN },
    { path: ['watcher', 'local', 'cron'], operation: 'set', value: '[REDACTED]' },
    { path: ['watcher', 'local', 'cron'], operation: 'remove', value: '' },
    { path: ['watcher', 'local', 'cron'], operation: 'unknown' },
    { path: ['watcher', 'local', 'cron'], operation: 'remove', extra: true },
  ])('refuses malformed operation %#', async (change) => {
    expect((await writeWatcherEdits({ revision: 'a'.repeat(43), changes: [change] })).status).toBe(
      400,
    );
  });

  test.each([{ suffix: ['cron'] }, { suffix: ['cron', 'nested'] }])(
    'refuses duplicate and overlapping paths %s',
    async ({ suffix }) => {
      const changes = [
        ['watcher', 'local', 'cron'],
        ['watcher', 'local', ...suffix],
      ].map((path) => ({ path, operation: 'remove' }));
      expect((await writeWatcherEdits({ revision: 'a'.repeat(43), changes })).status).toBe(400);
    },
  );

  test('accepts distinct fields in one edit and rejects unexpected body properties', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    const snapshot = await getWatcherEditSnapshot();
    const changes = [
      { path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' },
      { path: ['watcher', 'local', 'maintenancewindowtz'], operation: 'set', value: 'UTC' },
    ];
    expect(
      (await writeWatcherEdits({ revision: snapshot.revision, changes, extra: true })).status,
    ).toBe(400);
    expect((await writeWatcherEdits({ revision: snapshot.revision, changes })).saved).toBe(true);
  });

  test('projects only safe scalar values and ignores non-string YAML keys', async () => {
    fixture('watcher:\n  local:\n    7: ignored\n    cron: 7\n    maintenancewindow: true\n');
    (
      mockState.watcher['docker.local'] as { configuration: Record<string, unknown> }
    ).configuration = { cron: Number.NaN, maintenancewindow: true };
    const fields = (await getWatcherEditSnapshot()).watchers[0].fields;
    expect(fields.cron.value).toBe(7);
    expect(fields.cron.effectiveValue).toBeUndefined();
    expect(fields.maintenancewindow.effectiveValue).toBe(true);
  });

  test('does not create a missing configuration file', async () => {
    expect(await getWatcherEditSnapshot()).toMatchObject({
      available: false,
      readOnlyReason: 'configuration-file-unavailable',
    });
    expect(
      (
        await writeWatcherEdits({
          revision: 'a'.repeat(43),
          changes: [{ path: ['watcher', 'local', 'cron'], operation: 'remove' }],
        })
      ).status,
    ).toBe(409);
    fixture('{}');
    fs.unlinkSync(configPath);
    expect((await getWatcherEditSnapshot()).available).toBe(false);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  test('marks remote, missing and ambiguous watcher paths read-only', async () => {
    fixture(
      'watcher:\n  local:\n    cron: "0 */6 * * *"\n    maintenancewindow: "0 0 * * *"\n    maintenance_window: "0 1 * * *"\n',
    );
    mockState.watcher['edge.docker.local'] = {
      name: 'local',
      agent: 'edge',
      configuration: { cron: 'private-sentinel' },
    };
    mockState.watcher['docker.absent'] = { name: 'absent', configuration: {} };
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.watchers[0].fields.maintenancewindow.readOnlyReason).toBe(
      'ambiguous-field-alias',
    );
    expect(snapshot.watchers[1].fields.cron.readOnlyReason).toBe('agent-watcher');
    expect(snapshot.watchers[2].fields.cron.readOnlyReason).toBe('watcher-not-in-file');
    expect(JSON.stringify(snapshot)).not.toContain('private-sentinel');
  });

  test('preserves nested aliases and identifies scalar references without exposing them', async () => {
    fixture(
      'watcher:\n  local:\n    socket: &socket /var/run/docker.sock\n    cron: *socket\n    maintenance:\n      window_tz: UTC\n      window_scope: all\n',
    );
    const snapshot = await getWatcherEditSnapshot();
    expect(snapshot.watchers[0].fields.cron.readOnlyReason).toBe('referenced-field');
    expect(snapshot.watchers[0].fields.maintenancewindowtz.path).toEqual([
      'watcher',
      'local',
      'maintenance',
      'window_tz',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('docker.sock');
  });

  test('rejects invalid, oversized and unreadable documents without exposing input', async () => {
    for (const raw of [
      '[1,2]',
      'watcher: [invalid',
      'watcher: {}\nwatcher: {}',
      `# ${'a'.repeat(1024 * 1024)}\nwatcher: {}`,
    ]) {
      fixture(raw);
      await expect(getWatcherEditSnapshot()).rejects.toThrow();
    }
    fixture('{}');
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce(new Error('private-sentinel'));
    await expect(getWatcherEditSnapshot()).rejects.toThrow(
      /^Unable to read configuration for editing$/,
    );
  });

  test('refuses non-UTF8 source bytes instead of issuing a revision over replacement characters', async () => {
    fixture('watcher: {}\n');
    fs.writeFileSync(
      configPath,
      Buffer.concat([Buffer.from('# '), Buffer.from([0xff]), Buffer.from('\nwatcher: {}\n')]),
    );
    await expect(getWatcherEditSnapshot()).rejects.toThrow('Configuration must be UTF-8 text');
  });

  test('refuses external changes made while validation awaits secret I/O', async () => {
    const credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'private-value', { mode: 0o600 });
    fixture(
      `watcher:\n  local:\n    cron: "0 */6 * * *"\nregistry:\n  hub:\n    private:\n      login: reader\n      password:\n        _file: ${credentialPath}\n`,
    );
    const snapshot = await getWatcherEditSnapshot();
    const originalOpen = fs.promises.open;
    vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => {
      fs.appendFileSync(configPath, '# external edit\n');
      return originalOpen(...args);
    });
    const result = await writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
    });
    expect(result.status).toBe(409);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('# external edit');
    expect(mockReload).not.toHaveBeenCalled();
  });

  test('waits behind the legacy section write queue', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    const snapshot = await getWatcherEditSnapshot();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockReload.mockImplementationOnce(async () => {
      started();
      await pending;
      return { applied: true };
    });
    const legacy = writeConfigurationSection('watcher', { local: { cron: '0 */8 * * *' } });
    await entered;
    const edit = writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */12 * * *' }],
    });
    release();
    await legacy;
    expect((await edit).status).toBe(409);
  });

  test('reports a pre-save refusal and cleans temporary files on rename failure', async () => {
    fixture('watcher:\n  local:\n    cron: "0 */6 * * *"\n');
    const raw = fs.readFileSync(configPath, 'utf8');
    const snapshot = await getWatcherEditSnapshot();
    vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error('private-sentinel'));
    const result = await writeWatcherEdits({
      revision: snapshot.revision,
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 */8 * * *' }],
    });
    expect(result).toMatchObject({ status: 500, saved: false, applied: false });
    expect(result.revision).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private-sentinel');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(raw);
    expect(fs.readdirSync(directory)).toEqual(['drydock.yml']);
  });
});
