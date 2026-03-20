import { watch } from 'node:fs';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
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

  // mapCurrentVersionToUpdateVersion
  // -----------------------------------------------------------------------

  test('mapCurrentVersionToUpdateVersion should ignore services without image', () => {
    const compose = makeCompose({
      dd: { environment: ['DD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'] },
      portainer: { image: 'portainer/portainer-ce:2.27.4' },
    });
    const container = makeContainer({
      name: 'portainer',
      imageName: 'portainer/portainer-ce',
      tagValue: '2.27.4',
      remoteValue: '2.27.5',
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toEqual({
      service: 'portainer',
      current: 'portainer/portainer-ce:2.27.4',
      update: 'portainer/portainer-ce:2.27.5',
      currentNormalized: 'portainer/portainer-ce:2.27.4',
      updateNormalized: 'portainer/portainer-ce:2.27.5',
    });
  });

  test('mapCurrentVersionToUpdateVersion should prefer compose service label', () => {
    const compose = makeCompose({
      alpha: { image: 'nginx:1.0.0' },
      beta: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'beta' },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result?.service).toBe('beta');
  });

  test('mapCurrentVersionToUpdateVersion should not fall back to image matching when compose service label is unknown', () => {
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: {
        'com.docker.compose.project': 'other-stack',
        'com.docker.compose.service': 'unknown-service',
      },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should not fall back to image matching when compose identity labels exist without a service label', () => {
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
    });
    const container = makeContainer({
      labels: {
        'com.docker.compose.project': 'other-stack',
      },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should return undefined when service not found', () => {
    const compose = makeCompose({ redis: { image: 'redis:7.0.0' } });
    const container = makeContainer();

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find service'));
  });

  test('mapCurrentVersionToUpdateVersion should return undefined when service has no image', () => {
    const compose = makeCompose({ nginx: { build: './nginx' } });
    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('image is missing'));
  });

  // -----------------------------------------------------------------------
  // processComposeFile
  // -----------------------------------------------------------------------

  test('processComposeFile should not fail when compose has partial services', async () => {
    const container = makeContainer({
      name: 'portainer',
      imageName: 'portainer/portainer-ce',
      tagValue: '2.27.4',
      remoteValue: '2.27.5',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        dd: { environment: ['DD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'] },
        portainer: { image: 'portainer/portainer-ce:2.27.4' },
      }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/portainer.yml', [container]);

    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/portainer.yml',
      'portainer',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger both tag and digest updates', async () => {
    const tagContainer = makeContainer({ name: 'nginx' });
    const digestContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      tagContainer,
      digestContainer,
    ]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(2);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      tagContainer,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      digestContainer,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger digest-only updates even in dryrun mode', async () => {
    const container = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should skip compose writes but still trigger digest-only updates', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should trigger digest update when compose image uses implicit latest', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: 'latest',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should write digest-pinned image when digest pinning is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    trigger.configuration.digestPinning = true;

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      result: { digest: 'sha256:deadbeef' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx@sha256:deadbeef'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.not.stringContaining('image: nginx:1.1.0'),
    );
  });

  test('processComposeFile should trigger runtime update when update kind is unknown but update is available', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'filebrowser',
      imageName: 'filebrowser/filebrowser',
      tagValue: 'v2.59.0-s6',
      updateKind: 'unknown',
      remoteValue: null,
      updateAvailable: true,
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ filebrowser: { image: 'filebrowser/filebrowser:v2.59.0-s6' } }),
    );

    const { getComposeFileSpy, writeComposeFileSpy, composeUpdateSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(getComposeFileSpy).not.toHaveBeenCalled();
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'filebrowser',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should report when all mapped containers are already up to date', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.0.0',
      updateAvailable: false,
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    const updated = await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(updated).toBe(false);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should warn when no containers belong to compose', async () => {
    const container = makeContainer({
      name: 'unknown',
      imageName: 'unknown-image',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not found in compose file'));
  });

  test('processComposeFile should warn and continue on compose/runtime reconciliation mismatch by default', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:2.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Compose reconciliation mismatch'),
    );
    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should block updates on compose/runtime reconciliation mismatch when configured', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    trigger.configuration.reconciliationMode = 'block';

    const container = makeContainer({
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:2.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('Compose reconciliation mismatch');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should backup and write when not in dryrun mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { backupSpy, writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(backupSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.yml.back',
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx:1.1.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.not.stringContaining('image: nginx:1.0.0'),
    );
  });

  test('processComposeFile should only patch target image field and keep other matching strings unchanged', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithOtherImageStrings = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    environment:',
      '      - MIRROR_IMAGE=nginx:1.0.0',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
      trigger,
      composeWithOtherImageStrings,
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('MIRROR_IMAGE=nginx:1.0.0');
  });

  test('processComposeFile should not rewrite matching image strings in comments or env vars', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithCommentsAndEnv = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    # do not touch: nginx:1.0.0',
      '    environment:',
      '      - MIRROR_IMAGE=nginx:1.0.0',
      '      - COMMENT_IMAGE=nginx:1.0.0 # note',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger, composeWithCommentsAndEnv);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('# do not touch: nginx:1.0.0');
    expect(updatedCompose).toContain('MIRROR_IMAGE=nginx:1.0.0');
    expect(updatedCompose).toContain('COMMENT_IMAGE=nginx:1.0.0 # note');
  });

  test('processComposeFile should preserve commented-out fields in compose file', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const composeWithComments = [
      '# My production stack',
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '    # ports:',
      '    #   - "8080:80"',
      '    # volumes:',
      '    #   - ./html:/usr/share/nginx/html',
      '    environment:',
      '      - NGINX_PORT=80',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');
    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger, composeWithComments);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    const [, updatedCompose] = writeComposeFileSpy.mock.calls[0];
    expect(updatedCompose).toContain('# My production stack');
    expect(updatedCompose).toContain('    image: nginx:1.1.0');
    expect(updatedCompose).toContain('    # ports:');
    expect(updatedCompose).toContain('    #   - "8080:80"');
    expect(updatedCompose).toContain('    # volumes:');
    expect(updatedCompose).toContain('    #   - ./html:/usr/share/nginx/html');
    expect(updatedCompose).toContain('    environment:');
    expect(updatedCompose).toContain('    image: redis:7.0.0');
  });

  test('processComposeFile should fail when the same service resolves to conflicting image updates', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const containerA = makeContainer({
      name: 'nginx-a',
      remoteValue: '1.1.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const containerB = makeContainer({
      name: 'nginx-b',
      remoteValue: '1.2.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { writeComposeFileSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [containerA, containerB]),
    ).rejects.toThrow('Conflicting compose image updates for service nginx');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should return original compose text when computed service updates map is empty', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const composeFileText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'buildComposeServiceImageUpdates').mockReturnValue(new Map());
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(runLifecycleSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should parse compose text when cached compose document is unavailable', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const composeFileText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));
    vi.spyOn(trigger, 'getCachedComposeDocument').mockReturnValue(null);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx:1.1.0'),
    );
    expect(runLifecycleSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should fail when computed compose edits overlap', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });
    const composeFileText = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileText));

    const overlappingDoc = yaml.parseDocument(composeFileText, {
      keepSourceTokens: true,
      maxAliasCount: 10_000,
    });
    const servicesNode: any = overlappingDoc.get('services', true);
    const findImageValueNode = (serviceName: string) => {
      const servicePair = servicesNode.items.find((pair: any) => pair.key?.value === serviceName);
      return servicePair.value.items.find((pair: any) => pair.key?.value === 'image').value;
    };
    const nginxImageValueNode: any = findImageValueNode('nginx');
    const redisImageValueNode: any = findImageValueNode('redis');

    // Force equal start offsets with different end offsets to create deterministic overlap.
    nginxImageValueNode.range[0] = redisImageValueNode.range[0];
    nginxImageValueNode.range[1] = redisImageValueNode.range[0] + 1;

    vi.spyOn(trigger, 'getCachedComposeDocument').mockReturnValue(overlappingDoc);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [nginxContainer, redisContainer]),
    ).rejects.toThrow('Unable to apply overlapping compose edits');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(runLifecycleSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should not backup when backup is false', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { backupSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(backupSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should run post-start hooks for updated services', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();
    const serviceDefinition = {
      image: 'nginx:1.0.0',
      post_start: ['echo done'],
    };

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: serviceDefinition }),
    );

    const { hooksSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(hooksSpy).toHaveBeenCalledWith(container, 'nginx', serviceDefinition);
  });

  test('processComposeFile should pass compose context through update lifecycle', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(runLifecycleSpy).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: expect.objectContaining({ image: 'nginx:1.0.0' }),
      }),
    );
  });

  test('processComposeFile should filter out containers where mapCurrentVersionToUpdateVersion returns undefined', async () => {
    trigger.configuration.dryrun = false;

    const container1 = makeContainer();
    const container2 = makeContainer({
      name: 'unknown-container',
      imageName: 'unknown',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container1,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should ignore containers with unknown compose service labels even when image matches', async () => {
    trigger.configuration.dryrun = false;

    const containerInProject = makeContainer({
      name: 'nginx-main',
      labels: {
        'com.docker.compose.project': 'main-stack',
        'com.docker.compose.service': 'nginx',
      },
    });
    const containerFromOtherProject = makeContainer({
      name: 'nginx-other',
      labels: {
        'com.docker.compose.project': 'other-stack',
        'com.docker.compose.service': 'unknown-service',
      },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      containerInProject,
      containerFromOtherProject,
    ]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      containerInProject,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });

  test('processComposeFile should handle digest images with @ in compose file', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer({ tagValue: 'latest' });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx@sha256:abc123' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
  });

  test('processComposeFile should handle null image in mapCurrentVersionToUpdateVersion', async () => {
    trigger.configuration.dryrun = false;

    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { build: './nginx' } }),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('image is missing'));
  });

  test('processComposeFile should treat image with digest reference as up to date', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      tagValue: 'latest',
      updateKind: 'digest',
      remoteValue: 'sha256:deadbeef',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx@sha256:abc123' } }),
    );

    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No containers found'));
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should not trigger container updates when compose file write fails', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockRejectedValue(new Error('disk full'));
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('disk full');

    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should handle mapCurrentVersionToUpdateVersion returning undefined', async () => {
    trigger.configuration.dryrun = false;

    const container1 = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const container2 = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { build: './redis' },
      }),
    );

    const { composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container1, container2]);

    expect(composeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(composeUpdateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container1,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({
          dockerApi: mockDockerApi,
        }),
      }),
    );
  });
});
