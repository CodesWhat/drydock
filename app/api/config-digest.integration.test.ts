import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import yaml from 'yaml';
import { resetConfigFileLayer } from '../configuration/file/layer.js';
import { reloadConfiguration } from '../configuration/file/reload.js';
import {
  configFileInterpolatedKeys,
  configFileSources,
  ddEnvVars,
} from '../configuration/index.js';
import { getState, testable_deregisterComponent } from '../registry/index.js';
import * as notification from '../store/notification.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import Discord from '../triggers/providers/discord/Discord.js';
import * as configRouter from './config.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';
import * as triggerRouter from './trigger.js';

vi.mock('../api/audit-events.js', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('../registry/component-resolution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../registry/component-resolution.js')>();
  const { default: Component } = await vi.importActual<typeof import('../registry/Component.js')>(
    '../registry/Component.js',
  );
  return {
    ...actual,
    constructComponent: async (...args: Parameters<typeof actual.constructComponent>) => {
      const component = await actual.constructComponent(...args);
      // Retain real validation and notification lifecycle, without registry network startup.
      if (args[0] === 'registry' && component instanceof Component)
        vi.spyOn(component, 'init').mockResolvedValue(undefined);
      return component;
    },
  };
});

test('HTTP digest edits reload real templates, restore renderer defaults and leave DB overrides alone', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-digest-http-'));
  const configPath = path.join(directory, 'drydock.yml');
  const credentialPath = path.join(directory, 'credential');
  const previous = { ...ddEnvVars };
  const sources = { ...configFileSources };
  const interpolated = new Set(configFileInterpolatedKeys);
  const server = http.createServer();
  const database = createMigratedMemoryDatabase();
  try {
    notification.createCollections(database);
    notification.updateNotificationRule('security-alert', {
      templates: {
        'discord.private': {
          simpleTitle: 'DB title',
          simpleBody: 'DB body',
          batchTitle: 'DB batch',
        },
      },
    });
    const rules = notification.getNotificationRules();
    const send = vi.spyOn(Discord.prototype, 'sendMessage').mockResolvedValue(undefined);
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    ddEnvVars.DD_LOCAL_WATCHER = 'false';
    vi.stubEnv('DD_CONFIG_FILE', configPath);
    vi.stubEnv('DD_LOCAL_WATCHER', 'false');
    fs.writeFileSync(credentialPath, 'https://discord.example/private-credential', { mode: 0o600 });
    const raw = `# keep this comment\nnotification:\n  discord:\n    private:\n      url:\n        _file: ${credentialPath}\n      once: false\n      securitymode: digest\n      securitydigesttitle: '\${scan.alertCount} Original'\n`;
    fs.writeFileSync(configPath, raw, { mode: 0o600 });
    expect(await reloadConfiguration()).toMatchObject({ applied: true, errors: [] });
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/v1/config', configRouter.init());
    app.use('/api/v1/triggers', triggerRouter.init());
    server.on('request', app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
    const url = `http://127.0.0.1:${address.port}/api/v1/config/editor/triggers`;
    const snapshot = await (await fetch(url)).json();
    expect(snapshot.triggers[0].fields.securitydigesttitle.value).toBe(
      '${scan.alertCount} Original',
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/private-credential|credential/);
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/triggers',
        method: 'get',
        statusCode: '200',
        payload: snapshot,
      }),
    ).toEqual({ valid: true, errors: [] });
    const values = {
      securitydigesttitle: '${scan.alertCount} MiXeD Alerts',
      securitydigestbody: '${scan.scannedCount} scanned\n  KEEP Case\n',
    };
    const patch = (revision: string, changes: unknown[]) =>
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, changes }),
      });
    const changes = Object.entries(values).map(([field, value]) => ({
      path: ['notification', 'discord', 'private', field],
      operation: 'set',
      value,
    }));
    const response = await patch(snapshot.revision, changes);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toMatchObject({
      saved: true,
      applied: true,
      errors: [],
      reload: { reconcile: { changed: 1, errors: 0 } },
    });
    expect(send).not.toHaveBeenCalled();
    expect(notification.getNotificationRules()).toEqual(rules);
    const updated = await (await fetch(url)).json();
    for (const [field, value] of Object.entries(values))
      expect(updated.triggers[0].fields[field]).toMatchObject({ value, effectiveValue: value });
    const bytes = fs.readFileSync(configPath, 'utf8');
    expect(bytes).toContain('# keep this comment');
    expect(yaml.parse(bytes).notification.discord.private.url).toEqual({ _file: credentialPath });
    expect((await patch(snapshot.revision, changes)).status).toBe(409);
    expect((await patch(saved.revision, [{ ...changes[0], value: '' }])).status).toBe(400);
    const savedFile = fs.openSync(configPath, 'r');
    try {
      expect(fs.fstatSync(savedFile).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(savedFile, 'utf8')).toBe(bytes);
    } finally {
      fs.closeSync(savedFile);
    }
    const renderCycle = async (cycleId: string) => {
      const trigger = getState().trigger['discord.private'];
      expect(trigger).toBeInstanceOf(Discord);
      await trigger.handleSecurityAlertEvent({
        containerName: 'fixture',
        details: 'critical:1',
        cycleId,
        summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
      });
      await trigger.handleSecurityScanCycleCompleteEvent({
        cycleId,
        scannedCount: 2,
        startedAt: '2026-09-13T12:00:00.000Z',
        completedAt: '2026-09-13T12:01:00.000Z',
      });
    };
    // Only the outbound transport is replaced. Real public events invoke the existing renderer.
    await renderCycle('custom');
    expect(send).toHaveBeenLastCalledWith('1 MiXeD Alerts', '2 scanned\n  KEEP Case\n');
    const removed = await patch(
      saved.revision,
      changes.map(({ path }) => ({ path, operation: 'remove' })),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ saved: true, applied: true });
    expect(send).toHaveBeenCalledTimes(1);
    await renderCycle('default');
    expect(send).toHaveBeenLastCalledWith(
      'Security scan complete: 1 container with findings',
      expect.stringContaining('Security scan complete: 1 of 2 containers have findings.'),
    );
    expect(notification.getNotificationRules()).toEqual(rules);
    // Whole references retain loader semantics, but the editor must not return their values.
    vi.stubEnv('QA_TEST_SECRET', 'private-reference-sentinel');
    const referenceSnapshot = await (await fetch(url)).json();
    const referenceSave = await patch(referenceSnapshot.revision, [
      {
        path: ['notification', 'discord', 'private', 'securitydigesttitle'],
        operation: 'set',
        value: '${QA_TEST_SECRET}',
      },
    ]);
    expect(referenceSave.status).toBe(200);
    expect(await referenceSave.json()).toMatchObject({ saved: true, applied: true });
    const referenceAfter = await (await fetch(url)).json();
    expect(referenceAfter.triggers[0].fields.securitydigesttitle).toEqual({
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    });
    expect(JSON.stringify(referenceAfter)).not.toContain('private-reference-sentinel');
    const detail = await (
      await fetch(`http://127.0.0.1:${address.port}/api/v1/triggers/discord/private`)
    ).json();
    expect(detail.configuration.securitydigesttitle).toBe('private-reference-sentinel');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const kinds = ['registry', 'trigger', 'watcher', 'authentication', 'agent'] as const;
    await Promise.allSettled(
      kinds.flatMap((kind) =>
        Object.values(getState()[kind]).map((component) =>
          testable_deregisterComponent(component, kind),
        ),
      ),
    );
    database.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    Object.assign(ddEnvVars, previous);
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(configFileSources, sources);
    configFileInterpolatedKeys.clear();
    for (const key of interpolated) configFileInterpolatedKeys.add(key);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
