import { configFileInterpolatedKeys, configFileSources, ddEnvVars } from '../index.js';
import {
  buildCandidateEnvAndDiff,
  ddEnvKeyToSection,
  emptyDiff,
  RELOADABLE_SECTIONS,
} from './diff.js';

describe('emptyDiff', () => {
  test('returns an empty diff shape', () => {
    expect(emptyDiff()).toStrictEqual({ changed: [], reload: [], restart: [] });
  });
});

describe('ddEnvKeyToSection', () => {
  test('extracts the lowercased first segment after the DD_ prefix', () => {
    expect(ddEnvKeyToSection('DD_WATCHER_LOCAL_SOCKET')).toEqual('watcher');
  });

  test('returns undefined for a key with no segment past the prefix', () => {
    expect(ddEnvKeyToSection('DD_')).toBeUndefined();
  });
});

describe('RELOADABLE_SECTIONS', () => {
  test('contains exactly the sections spec-7.1-config-file.md marks as reload-safe', () => {
    expect([...RELOADABLE_SECTIONS].sort()).toEqual([
      'action',
      'notification',
      'registry',
      'watcher',
    ]);
  });
});

describe('buildCandidateEnvAndDiff', () => {
  beforeEach(() => {
    Object.keys(ddEnvVars).forEach((key) => delete ddEnvVars[key]);
    Object.keys(configFileSources).forEach((key) => delete configFileSources[key]);
    configFileInterpolatedKeys.clear();
  });

  test('reports a key present in the candidate file layer but not currently set as changed and reloadable', () => {
    const { diff, candidateEnv, candidateSources } = buildCandidateEnvAndDiff({
      DD_WATCHER_LOCAL_SOCKET: '/var/run/docker.sock',
    });

    expect(diff.changed).toContain('DD_WATCHER_LOCAL_SOCKET');
    expect(diff.reload).toEqual(['watcher']);
    expect(diff.restart).toEqual([]);
    expect(candidateEnv.DD_WATCHER_LOCAL_SOCKET).toEqual('/var/run/docker.sock');
    expect(candidateSources.DD_WATCHER_LOCAL_SOCKET).toEqual('file');
  });

  test('does not retain a resolved file secret as if it were owned by the environment', () => {
    ddEnvVars.DD_REGISTRY_HUB_PRIVATE_PASSWORD = 'old-private-value';
    configFileSources.DD_REGISTRY_HUB_PRIVATE_PASSWORD__FILE = 'file';
    const { candidateEnv } = buildCandidateEnvAndDiff({});
    expect(candidateEnv.DD_REGISTRY_HUB_PRIVATE_PASSWORD).toBeUndefined();
  });

  test('classifies a changed key outside the reloadable set as restart-required', () => {
    const { diff } = buildCandidateEnvAndDiff({ DD_SERVER_PORT: '4000' });

    expect(diff.changed).toContain('DD_SERVER_PORT');
    expect(diff.restart).toEqual(['server']);
    expect(diff.reload).toEqual([]);
  });

  test('never lets a candidate file value override a key currently sourced from the real environment', () => {
    ddEnvVars.DD_WATCHER_LOCAL_SOCKET = '/env/socket.sock';
    configFileSources.DD_WATCHER_LOCAL_SOCKET = 'env';
    const { candidateEnv, diff } = buildCandidateEnvAndDiff({
      DD_WATCHER_LOCAL_SOCKET: '/file/socket.sock',
    });

    expect(candidateEnv.DD_WATCHER_LOCAL_SOCKET).toEqual('/env/socket.sock');
    expect(diff.changed).not.toContain('DD_WATCHER_LOCAL_SOCKET');
  });

  test('reports no change when the candidate file layer matches the current file-sourced value', () => {
    ddEnvVars.DD_REGISTRY_HUB_PUBLIC_AUTH = 'anonymous';
    configFileSources.DD_REGISTRY_HUB_PUBLIC_AUTH = 'file';

    const { diff } = buildCandidateEnvAndDiff({ DD_REGISTRY_HUB_PUBLIC_AUTH: 'anonymous' });

    expect(diff.changed).not.toContain('DD_REGISTRY_HUB_PUBLIC_AUTH');
  });

  test('skips a changed key with no segment past the DD_ prefix rather than misclassifying it', () => {
    const { diff } = buildCandidateEnvAndDiff({ DD_: 'x' });
    expect(diff.changed).toContain('DD_');
    expect(diff.reload).toEqual([]);
    expect(diff.restart).toEqual([]);
  });

  test('reports a currently-interpolated key as changed when the candidate resolves it differently, even though its source reads env', () => {
    // Regression test: an interpolated file key attributes as 'env' in
    // configFileSources (decision D1), same as a genuinely environment-owned
    // key. Without configFileInterpolatedKeys, the old-file 'env' check
    // above would skip it here too, and a reload would never see it change.
    ddEnvVars.DD_WATCHER_LOCAL_SOCKET = '/interpolated/old.sock';
    configFileSources.DD_WATCHER_LOCAL_SOCKET = 'env';
    configFileInterpolatedKeys.add('DD_WATCHER_LOCAL_SOCKET');

    const { diff, candidateEnv } = buildCandidateEnvAndDiff({
      DD_WATCHER_LOCAL_SOCKET: '/literal/new.sock',
    });

    expect(diff.changed).toContain('DD_WATCHER_LOCAL_SOCKET');
    expect(diff.reload).toEqual(['watcher']);
    expect(candidateEnv.DD_WATCHER_LOCAL_SOCKET).toEqual('/literal/new.sock');
  });

  test('reports a currently-interpolated key as changed (removed) when the candidate no longer sets it', () => {
    ddEnvVars.DD_WATCHER_LOCAL_SOCKET = '/interpolated/old.sock';
    configFileSources.DD_WATCHER_LOCAL_SOCKET = 'env';
    configFileInterpolatedKeys.add('DD_WATCHER_LOCAL_SOCKET');

    const { diff, candidateEnv } = buildCandidateEnvAndDiff({});

    expect(diff.changed).toContain('DD_WATCHER_LOCAL_SOCKET');
    expect(diff.reload).toEqual(['watcher']);
    expect(candidateEnv.DD_WATCHER_LOCAL_SOCKET).toBeUndefined();
  });

  test('attributes an interpolated candidate key as env, not file, when envSourcedFileKeys names it', () => {
    const { candidateSources } = buildCandidateEnvAndDiff(
      { DD_WATCHER_LOCAL_SOCKET: '/interpolated/socket.sock' },
      new Set(['DD_WATCHER_LOCAL_SOCKET']),
    );

    expect(candidateSources.DD_WATCHER_LOCAL_SOCKET).toEqual('env');
  });
});
