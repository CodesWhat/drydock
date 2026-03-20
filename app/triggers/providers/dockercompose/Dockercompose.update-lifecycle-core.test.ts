import { watch } from 'node:fs';
import path from 'node:path';
import { emitContainerUpdateApplied, emitContainerUpdateFailed } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import * as backupStore from '../../../store/backup.js';
import Dockercompose from './Dockercompose.js';
import {
  makeCompose,
  makeContainer,
  setupDockercomposeTestContext,
  spyOnProcessComposeHelpers,
} from './Dockercompose.test.helpers.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSelfUpdateStarting: vi.fn(),
}));

vi.mock('../../../model/container.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fullName: vi.fn((c) => `test_${c.name}`),
  };
});

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
}));

// Modules used by the shared lifecycle (inherited from Docker trigger)
vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual('../../../configuration/index.js');
  return { ...actual, getSecurityConfiguration: vi.fn().mockReturnValue({ enabled: false }) };
});
vi.mock('../../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: vi.fn().mockReturnValue(null) }));
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: vi.fn(),
  verifyImageSignature: vi.fn(),
  generateImageSbom: vi.fn(),
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock('../../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      access: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('Dockercompose Trigger', () => {
  let trigger;
  let mockLog;
  let mockDockerApi;

  beforeEach(() => {
    ({ trigger, mockLog, mockDockerApi } = setupDockercomposeTestContext({
      DockercomposeCtor: Dockercompose,
      watchMock: watch,
      getStateMock: getState,
    }));
  });

  // Update lifecycle (security, hooks, backups, events)
  // -----------------------------------------------------------------------

  test('processComposeFile should use self-update branch for compose-managed Drydock', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'drydock' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ drydock: { image: 'codeswhat/drydock:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  drydock:', '    image: codeswhat/drydock:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const notifySpy = vi.spyOn(trigger, 'maybeNotifySelfUpdate').mockResolvedValue();
    const executeSelfUpdateSpy = vi.spyOn(trigger, 'executeSelfUpdate').mockResolvedValue(true);
    const postHookSpy = vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(executeSelfUpdateSpy).toHaveBeenCalledTimes(1);
    expect(postHookSpy).not.toHaveBeenCalled();
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should run full update lifecycle for non-dryrun update', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { maybeScanSpy, preHookSpy, postHookSpy, composeUpdateSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // Security scanning
    expect(maybeScanSpy).toHaveBeenCalledTimes(1);
    // Pre/post update hooks
    expect(preHookSpy).toHaveBeenCalledTimes(1);
    expect(postHookSpy).toHaveBeenCalledTimes(1);
    // Rollback monitor phase
    expect(rollbackMonitorSpy).toHaveBeenCalledTimes(1);
    // Compose update
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    // Backup inserted
    expect(backupStore.insertBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'nginx',
        imageTag: '1.0.0',
        triggerName: 'dockercompose.test',
      }),
    );
    // Backup pruning
    expect(backupStore.pruneOldBackups).toHaveBeenCalledWith('nginx', undefined);
    // Update applied event
    expect(emitContainerUpdateApplied).toHaveBeenCalledWith('local_nginx');
  });

  test('processComposeFile should run security scanning but skip post-update lifecycle in dryrun mode', async () => {
    trigger.configuration.dryrun = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { maybeScanSpy, preHookSpy, postHookSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // Security scanning runs even in dryrun (matches Docker behavior)
    expect(maybeScanSpy).toHaveBeenCalledTimes(1);
    // Pre-update hook still runs (can abort before dryrun pull)
    expect(preHookSpy).toHaveBeenCalledTimes(1);
    // Post-update hook skipped (performContainerUpdate returns false in dryrun)
    expect(postHookSpy).not.toHaveBeenCalled();
    // Rollback monitoring does not start because runtime update returns false in dryrun
    expect(rollbackMonitorSpy).not.toHaveBeenCalled();
    // Backup insertion is skipped in compose dryrun mode
    expect(backupStore.insertBackup).not.toHaveBeenCalled();
    // No update event (performContainerUpdate returned false)
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should emit failure event on error', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const helpers = spyOnProcessComposeHelpers(trigger);
    helpers.composeUpdateSpy.mockRejectedValue(new Error('compose pull failed'));

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('compose pull failed');

    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(emitContainerUpdateFailed).toHaveBeenCalledWith({
      containerName: 'local_nginx',
      error: 'compose pull failed',
    });
  });

  test('mapCurrentVersionToUpdateVersion should match services by raw image substring', () => {
    const compose = makeCompose({
      nginx: { image: 'ghcr.io/acme/nginx:1.0.0-alpine' },
    });
    const container = makeContainer({
      imageName: 'nginx',
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result?.service).toBe('nginx');
  });

  test('getComposeFilesFromProjectLabels should warn and skip invalid working directory and config file labels', () => {
    const composeFiles = trigger.getComposeFilesFromProjectLabels(
      {
        'com.docker.compose.project.working_dir': '\0invalid-workdir',
        'com.docker.compose.project.config_files': '/opt/drydock/test/stack.yml,\0invalid-file',
      },
      'test-container',
    );

    expect(composeFiles).toContain('/opt/drydock/test/stack.yml');
    expect(composeFiles).not.toContain('\0invalid-file');
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('com.docker.compose.project.working_dir'),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('com.docker.compose.project.config_files'),
    );
  });

  test('getComposeFilesFromInspect should return empty list when watcher has no docker api', async () => {
    vi.spyOn(trigger, 'getWatcher').mockReturnValue({} as any);

    await expect(
      trigger.getComposeFilesFromInspect({
        name: 'nginx',
      } as any),
    ).resolves.toEqual([]);
  });

  test('getComposeFilesFromInspect should return empty list when watcher lookup fails', async () => {
    vi.spyOn(trigger, 'getWatcher').mockReturnValue(null as any);

    await expect(
      trigger.getComposeFilesFromInspect({
        name: 'nginx',
      } as any),
    ).resolves.toEqual([]);
  });

  test('getComposeFilesFromInspect should return empty list when inspect fails', async () => {
    const inspectError = new Error('inspect failed');
    vi.spyOn(trigger, 'getWatcher').mockReturnValue({
      dockerApi: {
        modem: {},
        getContainer: vi.fn(() => ({
          inspect: vi.fn().mockRejectedValue(inspectError),
        })),
      },
    } as any);

    await expect(
      trigger.getComposeFilesFromInspect({
        name: 'nginx',
      } as any),
    ).resolves.toEqual([]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to inspect compose labels'),
    );
  });

  test('normalizeDigestPinningValue should normalize accepted digest formats', () => {
    expect(trigger.normalizeDigestPinningValue(undefined)).toBeNull();
    expect(trigger.normalizeDigestPinningValue('   ')).toBeNull();
    expect(trigger.normalizeDigestPinningValue('sha256:ABC123')).toBe('sha256:ABC123');
    expect(trigger.normalizeDigestPinningValue('abc123')).toBe('sha256:abc123');
    expect(trigger.normalizeDigestPinningValue('not-a-digest')).toBeNull();
  });

  test('normalizeComposeFileChain should return empty chain when no compose file is provided', () => {
    expect(trigger.normalizeComposeFileChain(undefined, undefined)).toEqual([]);
  });

  test('normalizeComposeFileChain should drop empty compose file entries', () => {
    expect(trigger.normalizeComposeFileChain('/opt/drydock/test/stack.yml', [''])).toEqual([]);
  });

  test('getComposeFilesFromProjectLabels should resolve config files relative to compose working directory', () => {
    const composeFiles = trigger.getComposeFilesFromProjectLabels(
      {
        'com.docker.compose.project.working_dir': '/opt/drydock/test',
        'com.docker.compose.project.config_files': 'stack.yml,stack.override.yml',
      },
      'test-container',
    );

    expect(composeFiles).toEqual([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);
  });

  test('resolveComposeFilesForContainer should map compose config file labels from host bind paths to container paths', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockImplementation((containerName) => {
      if (containerName === 'drydock-self') {
        return {
          inspect: vi.fn().mockResolvedValue({
            HostConfig: {
              Binds: ['/mnt/volume1/docker/stacks:/drydock:rw'],
            },
          }),
        };
      }
      return {
        inspect: vi.fn().mockResolvedValue({
          State: { Running: true },
        }),
      };
    });

    try {
      const composeFiles = await trigger.resolveComposeFilesForContainer({
        name: 'monitoring',
        watcher: 'local',
        labels: {
          'com.docker.compose.project.config_files':
            '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
        },
      });

      expect(composeFiles).toEqual(['/drydock/monitoring/compose.yaml']);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('parseHostToContainerBindMount should return null when bind definition is missing source or destination', () => {
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks')).toBeNull();
    expect(trigger.parseHostToContainerBindMount(':/drydock')).toBeNull();
  });

  test('parseHostToContainerBindMount should ignore trailing mount options', () => {
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:/drydock:rw')).toEqual(
      {
        source: '/mnt/volume1/docker/stacks',
        destination: '/drydock',
      },
    );
    expect(trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:/drydock:ro')).toEqual(
      {
        source: '/mnt/volume1/docker/stacks',
        destination: '/drydock',
      },
    );
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME contains slash', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'pod/name';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME is whitespace', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '   ';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME is undefined', () => {
    const originalHostname = process.env.HOSTNAME;
    delete process.env.HOSTNAME;

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME starts with non-alphanumeric character', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '-drydock-self';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return null when HOSTNAME has unsupported characters', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock$self';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBeNull();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('getSelfContainerIdentifier should return trimmed hostname when HOSTNAME is valid', () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = '  drydock-self  ';

    try {
      expect(trigger.getSelfContainerIdentifier()).toBe('drydock-self');
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('parseHostToContainerBindMount should return null when source or destination is not absolute', () => {
    expect(trigger.parseHostToContainerBindMount('relative/path:/drydock')).toBeNull();
    expect(
      trigger.parseHostToContainerBindMount('/mnt/volume1/docker/stacks:relative/path'),
    ).toBeNull();
  });

  test('ensureHostToContainerBindMountsLoaded should return early when watcher docker api is unavailable', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    vi.spyOn(trigger, 'getWatcher').mockReturnValue({} as any);

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({ name: 'monitoring' } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(false);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should wait for an in-flight load to finish', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    let resolveInspect: ((value: any) => void) | undefined;
    const inspectPromise = new Promise((resolve) => {
      resolveInspect = resolve;
    });
    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockReturnValue(inspectPromise),
    });

    try {
      const firstLoad = trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);
      await Promise.resolve();

      let secondLoadResolved = false;
      const secondLoad = trigger
        .ensureHostToContainerBindMountsLoaded({
          name: 'monitoring',
          watcher: 'local',
        } as any)
        .then(() => {
          secondLoadResolved = true;
        });

      await Promise.resolve();
      expect(secondLoadResolved).toBe(false);

      if (!resolveInspect) {
        throw new Error('resolveInspect was not initialized');
      }
      resolveInspect({
        HostConfig: {
          Binds: ['/mnt/volume1/docker/stacks:/drydock:rw'],
        },
      });

      await Promise.all([firstLoad, secondLoad]);

      expect(mockDockerApi.getContainer).toHaveBeenCalledTimes(1);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([
        {
          source: '/mnt/volume1/docker/stacks',
          destination: '/drydock',
        },
      ]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should skip when bind definitions are not an array', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          Binds: null,
        },
      }),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(true);
      expect(trigger.getHostToContainerBindMountCache()).toEqual([]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should parse and sort bind mounts by source path length', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          Binds: ['/mnt/volume1/docker:/drydock-base:rw', '/mnt/volume1/docker/stacks:/drydock:rw'],
        },
      }),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.getHostToContainerBindMountCache()).toEqual([
        {
          source: '/mnt/volume1/docker/stacks',
          destination: '/drydock',
        },
        {
          source: '/mnt/volume1/docker',
          destination: '/drydock-base',
        },
      ]);
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('ensureHostToContainerBindMountsLoaded should log debug message when inspect fails', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'drydock-self';

    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
    });

    try {
      await trigger.ensureHostToContainerBindMountsLoaded({
        name: 'monitoring',
        watcher: 'local',
      } as any);

      expect(trigger.isHostToContainerBindMountCacheLoaded()).toBe(true);
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to inspect bind mounts for compose host-path remapping'),
      );
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('mapComposePathToContainerBindMount should map exact source paths to destination paths', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
        destination: '/drydock/monitoring/compose.yaml',
      },
    ]);

    const mappedPath = trigger.mapComposePathToContainerBindMount(
      '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
    );

    expect(mappedPath).toBe('/drydock/monitoring/compose.yaml');
  });

  test('mapComposePathToContainerBindMount should map nested files when bind source ends with path separator', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);

    const mappedPath = trigger.mapComposePathToContainerBindMount(
      '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
    );

    expect(mappedPath).toBe('/drydock/monitoring/compose.yaml');
  });

  test('mapComposePathToContainerBindMount should return original path when no bind source matches', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);

    const composePath = '/opt/other/stack/compose.yaml';
    const mappedPath = trigger.mapComposePathToContainerBindMount(composePath);

    expect(mappedPath).toBe(composePath);
  });

  test('mapComposePathToContainerBindMount should return destination root when computed relative path is empty', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('');

    try {
      const mappedPath = trigger.mapComposePathToContainerBindMount(
        '/mnt/volume1/docker/stacks/monitoring/compose.yaml',
      );
      expect(mappedPath).toBe('/drydock/');
    } finally {
      relativeSpy.mockRestore();
    }
  });

  test('mapComposePathToContainerBindMount should skip unsafe relative compose paths that escape source', () => {
    trigger.setHostToContainerBindMountCache([
      {
        source: '/mnt/volume1/docker/stacks/',
        destination: '/drydock/',
      },
    ]);
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValueOnce('../escape');

    try {
      const composePath = '/mnt/volume1/docker/stacks/monitoring/compose.yaml';
      const mappedPath = trigger.mapComposePathToContainerBindMount(composePath);
      expect(mappedPath).toBe(composePath);
    } finally {
      relativeSpy.mockRestore();
    }
  });

  test('getImageNameFromReference should parse image names from tags and digests', () => {
    expect(trigger.getImageNameFromReference(undefined)).toBeUndefined();
    expect(trigger.getImageNameFromReference('nginx:1.0.0')).toBe('nginx');
    expect(trigger.getImageNameFromReference('ghcr.io/acme/web@sha256:abc')).toBe(
      'ghcr.io/acme/web',
    );
    expect(trigger.getImageNameFromReference('ghcr.io/acme/web')).toBe('ghcr.io/acme/web');
  });

  test('getComposeMutationImageReference should honor digest pinning settings and fallbacks', () => {
    const container = makeContainer({
      updateKind: 'digest',
      remoteValue: 'abc123',
      result: {},
    });
    trigger.configuration.digestPinning = false;
    expect(trigger.getComposeMutationImageReference(container as any, 'nginx:1.1.0')).toBe(
      'nginx:1.1.0',
    );

    trigger.configuration.digestPinning = true;
    expect(trigger.getComposeMutationImageReference(container as any, '')).toBe('');
    expect(trigger.getComposeMutationImageReference(container as any, 'nginx:1.1.0')).toBe(
      'nginx@sha256:abc123',
    );
    expect(
      trigger.getComposeMutationImageReference(
        makeContainer({ updateKind: 'digest', remoteValue: 'invalid' }) as any,
        'nginx:1.1.0',
      ),
    ).toBe('nginx:1.1.0');
    expect(
      trigger.getComposeMutationImageReference(
        makeContainer({ updateKind: 'tag', remoteValue: '1.1.0' }) as any,
        'nginx:1.1.0',
      ),
    ).toBe('nginx:1.1.0');
  });

  test('getComposeMutationImageReference should preserve explicit docker.io prefix from compose image', () => {
    const container = makeContainer({
      updateKind: 'digest',
      remoteValue: 'abc123',
      result: {},
    });

    trigger.configuration.digestPinning = false;
    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('docker.io/nginx:1.1.0');

    trigger.configuration.digestPinning = true;
    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('docker.io/nginx@sha256:abc123');

    expect(
      trigger.getComposeMutationImageReference(
        container as any,
        'ghcr.io/acme/nginx:1.1.0',
        'docker.io/nginx:1.0.0',
      ),
    ).toBe('ghcr.io/acme/nginx@sha256:abc123');
  });

  test('buildComposeServiceImageUpdates should use runtime update image when compose update override is missing', () => {
    const serviceUpdates = trigger.buildComposeServiceImageUpdates([
      {
        service: 'nginx',
        update: 'nginx:1.1.0',
      },
    ] as any);

    expect(serviceUpdates.get('nginx')).toBe('nginx:1.1.0');
  });

  test('buildUpdatedComposeFileObjectForValidation should return undefined for non-object input', () => {
    const updated = trigger.buildUpdatedComposeFileObjectForValidation(null, new Map());

    expect(updated).toBeUndefined();
  });
});
