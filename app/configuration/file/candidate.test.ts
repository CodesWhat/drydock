import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configFileInterpolatedKeys,
  configFileSources,
  ddEnvVars,
  replaceSecrets,
} from '../index.js';
import { resolveCandidateEnvAndDiff } from './candidate.js';
import { mergeConfigLayers } from './sources.js';

describe('private candidate resolution', () => {
  let directory: string;
  let credentialPath: string;
  let current: typeof ddEnvVars;
  let sources: typeof configFileSources;
  let interpolated: Set<string>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-candidate-'));
    credentialPath = path.join(directory, 'credential');
    fs.writeFileSync(credentialPath, 'new-private-value\n', { mode: 0o600 });
    current = { ...ddEnvVars };
    sources = { ...configFileSources };
    interpolated = new Set(configFileInterpolatedKeys);
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    configFileInterpolatedKeys.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    Object.assign(ddEnvVars, current);
    Object.assign(configFileSources, sources);
    configFileInterpolatedKeys.clear();
    for (const key of interpolated) configFileInterpolatedKeys.add(key);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('rereads environment-owned secret files instead of freezing their startup contents', async () => {
    vi.stubEnv('DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE', credentialPath);
    ddEnvVars.DD_REGISTRY_HUB_PRIVATE_PASSWORD = 'old-private-value';
    configFileSources.DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE = 'env';
    const result = await resolveCandidateEnvAndDiff({});
    expect(result.candidateEnv.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBe('new-private-value');
    expect(result.candidateSources.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBe('env');
    expect(ddEnvVars.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBe('old-private-value');
  });

  test('resolves interpolated file markers and normalizes source and diff metadata', async () => {
    ddEnvVars.DD_ = 'old-sectionless';
    configFileSources.DD_ = 'file';
    ddEnvVars.DD_REGISTRY_HUB_PRIVATE_PASSWORD = 'old-private-value';
    configFileSources.DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE = 'env';
    configFileInterpolatedKeys.add('DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE');
    const result = await resolveCandidateEnvAndDiff(
      {
        DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE: credentialPath,
        DD_SERVER_PORT: '4000',
      },
      new Set(['DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE']),
    );
    expect(result.candidateEnv.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBe('new-private-value');
    expect(result.candidateEnv.DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE).toBeUndefined();
    expect(result.interpolatedKeys).toEqual(new Set(['DD_REGISTRY_HUB_PRIVATE_PASSWORD']));
    expect(result.diff).toEqual({
      changed: ['DD_', 'DD_REGISTRY_HUB_PRIVATE_PASSWORD', 'DD_SERVER_PORT'],
      reload: ['registry'],
      restart: ['server'],
    });
    expect(result.candidateSources.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBe('env');
  });

  test('secret resolution failures never include paths or private data', async () => {
    await expect(
      resolveCandidateEnvAndDiff({
        DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE: path.join(directory, 'missing-private-path'),
      }),
    ).rejects.toThrow(/^Unable to resolve configuration secret files$/);
  });

  test('matches startup when a YAML file reference overlays a real environment base, including removal', async () => {
    const key = 'DD_REGISTRY_HUB_PRIVATE_PASSWORD';
    vi.stubEnv(key, 'environment-private-value');
    const layer = { [`${key}__FILE`]: credentialPath };
    const startupEnv = { [key]: process.env[key] };
    const startupSources = mergeConfigLayers(startupEnv, layer);
    await replaceSecrets(startupEnv);
    Object.assign(ddEnvVars, startupEnv);
    Object.assign(configFileSources, startupSources);
    expect((await resolveCandidateEnvAndDiff(layer)).candidateEnv[key]).toBe(startupEnv[key]);
    expect((await resolveCandidateEnvAndDiff({})).candidateEnv[key]).toBe(
      'environment-private-value',
    );
  });

  test('live configuration stays unchanged while a private candidate awaits secret I/O', async () => {
    ddEnvVars.DD_SERVER_PORT = '3000';
    configFileSources.DD_SERVER_PORT = 'file';
    const originalOpen = fs.promises.open;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      await pending;
      return originalOpen(...args);
    });
    const resultPromise = resolveCandidateEnvAndDiff({
      DD_SERVER_PORT: '4000',
      DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE: credentialPath,
    });
    expect(ddEnvVars).toEqual({ DD_SERVER_PORT: '3000' });
    release();
    const result = await resultPromise;
    expect(result.candidateEnv.DD_SERVER_PORT).toBe('4000');
    expect(ddEnvVars).toEqual({ DD_SERVER_PORT: '3000' });
  });
});
