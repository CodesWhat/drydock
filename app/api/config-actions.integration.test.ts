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

const { state, reload, audit } = vi.hoisted(() => ({
  state: { trigger: {}, watcher: {} },
  reload: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../registry/index.js', () => ({ getState: () => state }));
vi.mock('../configuration/file/reload.js', () => ({ reloadConfiguration: reload }));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: audit }));

test('the actions HTTP editor saves three fields with real Joi while preserving private YAML', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-action-http-'));
  const configPath = path.join(directory, 'drydock.yml');
  const credentialPath = path.join(directory, 'credential');
  const previous = { ...ddEnvVars };
  const sources = { ...configFileSources };
  const server = http.createServer();
  try {
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    fs.writeFileSync(credentialPath, 'private-credential', { mode: 0o600 });
    const raw = `# preserve comment\nAction:\n  Command:\n    Private:\n      cmd: 'echo private-command'\n      auto: oninclude # policy\nRegistry:\n  hub:\n    private:\n      login: \${REGISTRY_LOGIN:-reader}\n      password:\n        _file: ${credentialPath}\n`;
    fs.writeFileSync(configPath, raw, { mode: 0o600 });
    setConfigFileLayer({}, new Set(), { path: configPath, modifiedAt: new Date().toISOString() });
    state.trigger = {
      'command.private': {
        type: 'command',
        name: 'private',
        configuration: { auto: 'oninclude', order: 100 },
      },
    };
    reload.mockResolvedValue({ applied: true, errors: [] });
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/v1/config', configRouter.init());
    server.on('request', app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
    const url = `http://127.0.0.1:${address.port}/api/v1/config/editor/actions`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.actions[0]).toMatchObject({ id: 'command.private', category: 'action' });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private-command|private-credential|REGISTRY_LOGIN|credential/,
    );
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/actions',
        method: 'get',
        statusCode: '200',
        payload: snapshot,
      }),
    ).toEqual({ valid: true, errors: [] });
    const saved = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: snapshot.revision,
        changes: [
          { path: ['Action', 'Command', 'Private', 'auto'], operation: 'set', value: false },
          { path: ['Action', 'Command', 'Private', 'order'], operation: 'set', value: -2.5 },
          { path: ['Action', 'Command', 'Private', 'concurrency'], operation: 'set', value: 3 },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const outcome = await saved.json();
    expect(outcome).toMatchObject({ saved: true, applied: true, errors: [] });
    expect(
      validateOpenApiJsonResponse({
        path: '/api/v1/config/editor/actions',
        method: 'patch',
        statusCode: '200',
        payload: outcome,
      }),
    ).toEqual({ valid: true, errors: [] });
    const result = fs.readFileSync(configPath, 'utf8');
    expect(yaml.parse(result).Action.Command.Private).toEqual({
      cmd: 'echo private-command',
      auto: false,
      order: -2.5,
      concurrency: 3,
    });
    expect(yaml.parse(result).Registry).toEqual(yaml.parse(raw).Registry);
    expect(result).toContain('# preserve comment');
    expect(result).toContain('# policy');
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/private-command|private-credential/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(ddEnvVars, previous);
    Object.assign(configFileSources, sources);
    resetConfigFileLayer();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
