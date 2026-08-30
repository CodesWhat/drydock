import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import {
  getUpdateLockSnapshot,
  releaseRetainedSelfUpdateLifecycle,
  withContainerUpdateLocks,
} from '../../../updates/update-locks.js';
import { RetainSelfUpdateLifecycleError } from '../docker/SelfUpdateTransitionShared.js';
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
  getBackupsForContainer: vi.fn().mockReturnValue([]),
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
  getContainers: vi.fn().mockReturnValue([]),
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

  test('mapCurrentVersionToUpdateVersion should match a service through its resolved default image', () => {
    const compose = makeCompose({
      nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' },
    });
    const container = makeContainer({
      imageName: 'docker.io/library/nginx',
      labels: undefined,
    });

    const result = trigger.mapCurrentVersionToUpdateVersion(compose, container);

    expect(result?.service).toBe('nginx');
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

  test('processComposeFile should resolve an image variable for continuity while preserving it until mutation', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    try {
      const container = makeContainer({
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: '${IMAGE}' } }),
      );
      vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) =>
        String(filePath).endsWith('/.env') ? Buffer.from('IMAGE=nginx:1.0.0\n') : Buffer.from(''),
      );

      const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
        trigger,
        ['services:', '  nginx:', '    image: ${IMAGE}', ''].join('\n'),
      );

      await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

      expect(writeComposeFileSpy).toHaveBeenCalledWith(
        '/opt/drydock/test/stack.yml',
        expect.stringContaining('image: nginx:1.1.0'),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('getComposeResolvedImages should not use a service declared environment file', async () => {
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) =>
      String(filePath).endsWith('/stack.env')
        ? Buffer.from('export IMAGE="nginx:1.0.0"\nBROKEN=\'unterminated\n')
        : Buffer.from(''),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: { image: '${IMAGE}', env_file: 'stack.env' } }),
    );

    expect(result).toEqual(new Map());
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledWith('/opt/drydock/test/.env', 'utf8');
  });

  test('getComposeResolvedImages should return no overrides for literal images', async () => {
    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );

    expect(result).toEqual(new Map());
  });

  test('getComposeResolvedImages should handle a missing compose document', async () => {
    await expect(
      trigger.getComposeResolvedImages(['/opt/drydock/test/stack.yml'], undefined),
    ).resolves.toEqual(new Map());
  });

  test('getComposeResolvedImages should ignore non-string declared environment paths', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: { image: '${IMAGE}', env_file: [123] } }),
    );

    expect(result).toEqual(new Map());
    expect(fs.readFile).toHaveBeenCalledWith('/opt/drydock/test/.env', 'utf8');
  });

  test('getComposeResolvedImages should use only the base project environment file', async () => {
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
      if (String(filePath) === '/opt/drydock/project/.env') {
        return Buffer.from('IMAGE=nginx:1.0.0\n');
      }
      return Buffer.from('IMAGE=postgres:16\n');
    });

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/project/stack.yml', '/opt/drydock/override/stack.yml'],
      makeCompose({ nginx: { image: '${IMAGE}', env_file: '../secrets.env' } }),
    );

    expect(result).toEqual(new Map([['nginx', 'nginx:1.0.0']]));
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledWith('/opt/drydock/project/.env', 'utf8');
  });

  test('getComposeResolvedImages should fail closed for unsupported project environment syntax', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from(
        'IMAGE=$(hostname)\nBARE=$HOST\nBADESC="foo\\q"\nTRAILING="ok" trailing\nBADQUOTE=\'ok\' trailing\nBROKEN="unterminated\n',
      ),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: { image: '${IMAGE}' }, bare: { image: '${BARE}' } }),
    );

    expect(result).toEqual(new Map());
  });

  test('getComposeResolvedImages should parse Compose project environment syntax', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from(
        [
          'HOST=ghcr.io # inline comment',
          'NAMESPACE=acme',
          'REGISTRY: ${HOST}',
          'DEFAULT_REGISTRY=${HOST:-docker.io}',
          'IMAGE_PATH="${NAMESPACE}/app"',
          "TAG='1.2'",
          "MULTILINE='line-one",
          "line-two'",
          'ESCAPED="ghcr.io/acme/app:1.2\\n"',
          'MISSING_DEFAULT=${MISSING:-fallback}',
          'SINGLE_DEFAULT=${MISSING-fallback}',
          'BROKEN_REF=${MISSING}',
          'CYCLE_A=${CYCLE_B}',
          'CYCLE_B=${CYCLE_A}',
          '',
        ].join('\n'),
      ),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        nginx: { image: '${REGISTRY}/${IMAGE_PATH}:${TAG}' },
        defaultedNested: { image: '${DEFAULT_REGISTRY}/acme/app:1.2' },
        multiline: { image: '${MULTILINE}' },
        escaped: { image: '${ESCAPED}' },
      }),
    );

    expect(result).toEqual(
      new Map([
        ['nginx', 'ghcr.io/acme/app:1.2'],
        ['defaultedNested', 'ghcr.io/acme/app:1.2'],
        ['multiline', 'line-one\nline-two'],
        ['escaped', 'ghcr.io/acme/app:1.2\n'],
      ]),
    );
  });

  test('getComposeResolvedImages should preserve single-quoted literals and resolve values at assignment time', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from(
        [
          'HOST=ghcr.io',
          "SINGLE='${HOST}/literal:1'",
          'DOUBLE="${HOST}/double:1"',
          'UNQUOTED=${HOST}/unquoted:1',
          'ESCAPED="\\${HOST}/escaped:1"',
          '',
        ].join('\n'),
      ),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        single: { image: '${SINGLE}' },
        double: { image: '${DOUBLE}' },
        unquoted: { image: '${UNQUOTED}' },
        escaped: { image: '${ESCAPED}' },
      }),
    );

    expect(result).toEqual(
      new Map([
        ['double', 'ghcr.io/double:1'],
        ['unquoted', 'ghcr.io/unquoted:1'],
      ]),
    );
  });

  test('getComposeResolvedImages should resolve project values only from earlier assignments', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from('IMAGE=${HOST}/before-host:1\nHOST=ghcr.io\n'),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ before: { image: '${IMAGE}' } }),
    );

    expect(result).toEqual(new Map());
  });

  test('getComposeResolvedImages should invalidate authority after an unsupported duplicate assignment', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from('IMAGE=nginx:1\nIMAGE=$(hostname)\nIMAGE=postgres:16\n'),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: { image: '${IMAGE}' } }),
    );

    expect(result).toEqual(new Map());
  });

  test('getComposeResolvedImages should consume a poisoned multiline duplicate before continuing', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from("IMAGE=$(hostname)\nIMAGE='ignored\nOTHER=nginx:1\n'\n"),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        image: { image: '${IMAGE}' },
        other: { image: '${OTHER:-postgres:16}' },
      }),
    );

    expect(result).toEqual(new Map([['other', 'postgres:16']]));
  });

  test('getComposeResolvedImages should consume a poisoned multiline double-quoted duplicate before continuing', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      Buffer.from('IMAGE=$(hostname)\nIMAGE="ignored\nOTHER=nginx:1\n"\n'),
    );

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        image: { image: '${IMAGE}' },
        other: { image: '${OTHER:-postgres:16}' },
      }),
    );

    expect(result).toEqual(new Map([['other', 'postgres:16']]));
  });

  test('getComposeResolvedImages should honor the last supported duplicate assignment', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('IMAGE=nginx:1\nIMAGE=postgres:16\n'));

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ postgres: { image: '${IMAGE}' } }),
    );

    expect(result).toEqual(new Map([['postgres', 'postgres:16']]));
  });

  test('getComposeResolvedImages should apply default interpolation for unset and empty values', async () => {
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) =>
      String(filePath).startsWith('/opt/drydock/unset/')
        ? ''
        : String(filePath).startsWith('/opt/drydock/configured/')
          ? Buffer.from('REGISTRY=ghcr.io\n')
          : Buffer.from('REGISTRY=\n'),
    );

    const unsetResult = await trigger.getComposeResolvedImages(
      ['/opt/drydock/unset/stack.yml'],
      makeCompose({
        nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' },
      }),
    );
    const emptyResult = await trigger.getComposeResolvedImages(
      ['/opt/drydock/empty/stack.yml'],
      makeCompose({
        nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' },
      }),
    );
    const configuredResult = await trigger.getComposeResolvedImages(
      ['/opt/drydock/configured/stack.yml'],
      makeCompose({
        nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' },
      }),
    );

    expect(unsetResult).toEqual(new Map([['nginx', 'docker.io/library/nginx:1.0.0']]));
    expect(emptyResult).toEqual(new Map([['nginx', 'docker.io/library/nginx:1.0.0']]));
    expect(configuredResult).toEqual(new Map([['nginx', 'ghcr.io/library/nginx:1.0.0']]));
  });

  test('getComposeResolvedImages should preserve empty values for the single-dash default', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('REGISTRY=\n'));

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        nginx: { image: '${REGISTRY-docker.io}/library/nginx:1.0.0' },
      }),
    );

    expect(result).toEqual(new Map([['nginx', '/library/nginx:1.0.0']]));
  });

  test('getComposeResolvedImages should ignore malformed and image-less service definitions', async () => {
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

    const result = await trigger.getComposeResolvedImages(
      ['/opt/drydock/test/stack.yml'],
      makeCompose({
        nginx: { image: '${IMAGE}' },
        malformed: 'not a service',
        noImage: { environment: { IMAGE: 'nginx:1.0.0' } },
      }),
    );

    expect(result).toEqual(new Map());
  });

  test('processComposeFile should fail closed when an image variable is unavailable', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    try {
      const container = makeContainer({
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: '${IMAGE}' } }),
      );
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

      const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
        trigger,
        ['services:', '  nginx:', '    image: ${IMAGE}', ''].join('\n'),
      );

      await expect(
        trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
      ).rejects.toThrow('refusing to rewrite a different repository');

      expect(writeComposeFileSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('processComposeFile should resolve a defaulted registry variable for continuity', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    try {
      const container = makeContainer({
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' } }),
      );
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

      const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
        trigger,
        ['services:', '  nginx:', '    image: ${REGISTRY:-docker.io}/library/nginx:1.0.0', ''].join(
          '\n',
        ),
      );

      await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

      expect(writeComposeFileSpy).toHaveBeenCalledWith(
        '/opt/drydock/test/stack.yml',
        expect.stringContaining('image: nginx:1.1.0'),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('processComposeFile should reject a runtime image from another registry with a literal default', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    try {
      const container = makeContainer({
        imageName: 'ghcr.io/library/nginx',
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: '${REGISTRY:-docker.io}/library/nginx:1.0.0' } }),
      );
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

      const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
        trigger,
        ['services:', '  nginx:', '    image: ${REGISTRY:-docker.io}/library/nginx:1.0.0', ''].join(
          '\n',
        ),
      );

      await expect(
        trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
      ).rejects.toThrow('refusing to rewrite a different repository');
      expect(writeComposeFileSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('processComposeFile should abort before mutation when container identity is indeterminate', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'classifySelfUpdate').mockResolvedValue('indeterminate');
    const applyMutationsSpy = vi
      .spyOn(trigger, 'maybeApplyComposeFileMutations')
      .mockResolvedValue([]);

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('Drydock container identity is indeterminate');
    expect(applyMutationsSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should ignore a foreign Drydock environment value', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const previousImage = process.env.IMAGE;
    process.env.IMAGE = 'postgres:9.9.9';
    try {
      const container = makeContainer({
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: '${IMAGE}' } }),
      );
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

      const { writeComposeFileSpy, composeUpdateSpy, backupSpy } = spyOnProcessComposeHelpers(
        trigger,
        ['services:', '  nginx:', '    image: ${IMAGE}', ''].join('\n'),
      );

      await expect(
        trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
      ).rejects.toThrow('refusing to rewrite a different repository');

      expect(writeComposeFileSpy).not.toHaveBeenCalled();
      expect(composeUpdateSpy).not.toHaveBeenCalled();
      expect(backupSpy).not.toHaveBeenCalled();
    } finally {
      if (previousImage === undefined) {
        delete process.env.IMAGE;
      } else {
        process.env.IMAGE = previousImage;
      }
      vi.restoreAllMocks();
    }
  });

  test('processComposeFile should fail closed for a mislabeled runtime with unresolved image config', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      imageName: 'postgres',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: '${IMAGE}' } }),
    );
    vi.spyOn(trigger, 'getComposeResolvedImages').mockResolvedValue(new Map());

    const { writeComposeFileSpy, composeUpdateSpy, backupSpy } = spyOnProcessComposeHelpers(
      trigger,
      ['services:', '  nginx:', '    image: ${IMAGE}', ''].join('\n'),
    );

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(backupSpy).not.toHaveBeenCalled();
  });

  test('repository continuity should compare invariant paths around interpolation', () => {
    const composeImage = '${REGISTRY:-docker.io}/acme/app:${TAG}';
    const matchingMapping = {
      service: 'app',
      current: composeImage,
      runtimeImage: 'docker.io/acme/app:1.0.0',
      container: { name: 'app' },
    };
    const foreignMapping = {
      ...matchingMapping,
      runtimeImage: 'nginx:1.0.0',
    };

    expect(() =>
      trigger.assertComposeRepositoryContinuity('/opt/drydock/test/stack.yml', [matchingMapping]),
    ).not.toThrow();
    expect(() =>
      trigger.assertComposeRepositoryContinuity('/opt/drydock/test/stack.yml', [foreignMapping]),
    ).toThrow('refusing to rewrite a different repository');
  });

  test('reconciliation should not reject a proven repository when only the tag is unresolved', () => {
    trigger.configuration.reconciliationMode = 'block';

    expect(() =>
      trigger.reconcileComposeMappings('/opt/drydock/test/stack.yml', [
        {
          service: 'app',
          current: '${REGISTRY:-docker.io}/acme/app:${TAG}',
          currentResolved: 'docker.io/acme/app:${TAG}',
          runtimeImage: 'docker.io/acme/app:1.0.0',
          runtimeNormalized: 'docker.io/acme/app:1.0.0',
          container: { name: 'app' },
        },
      ]),
    ).not.toThrow();
  });

  test('processComposeFile should reject another registry when the image tag remains unresolved', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      imageName: 'ghcr.io/acme/app',
      labels: { 'com.docker.compose.service': 'app' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ app: { image: '${REGISTRY:-docker.io}/acme/app:${TAG}' } }),
    );
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from(''));

    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
      trigger,
      ['services:', '  app:', '    image: ${REGISTRY:-docker.io}/acme/app:${TAG}', ''].join('\n'),
    );

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('refusing to rewrite a different repository');
    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('processComposeFile should wait for queued exclusive lifecycle access before mutating compose files', async () => {
    let markExclusiveStarted!: () => void;
    const exclusiveStarted = new Promise<void>((resolve) => {
      markExclusiveStarted = resolve;
    });
    let releaseExclusive!: () => void;
    const exclusiveFinished = new Promise<void>((resolve) => {
      releaseExclusive = resolve;
    });
    const exclusive = withContainerUpdateLocks(
      ['test:exclusive-compose-review'],
      async () => {
        markExclusiveStarted();
        await exclusiveFinished;
      },
      { bypassGlobalCap: true, exclusive: true },
    );
    await exclusiveStarted;

    try {
      trigger.configuration.dryrun = false;
      trigger.configuration.backup = false;
      const container = makeContainer({
        tagValue: '1.0.0',
        remoteValue: '1.1.0',
        labels: { 'com.docker.compose.service': 'nginx' },
      });
      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
      );
      const { writeComposeFileSpy } = spyOnProcessComposeHelpers(trigger);

      const processPromise = trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeComposeFileSpy).not.toHaveBeenCalled();

      releaseExclusive();
      await processPromise;
      expect(writeComposeFileSpy).toHaveBeenCalled();
    } finally {
      releaseExclusive();
      await exclusive;
    }
  });

  test('concurrent compose processing should pass admission state per call', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const firstContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const secondContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      labels: { 'com.docker.compose.service': 'redis' },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:1.0.0' },
      }),
    );
    const applyReleases: Array<() => void> = [];
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockImplementation(
      () =>
        new Promise((resolve) => {
          applyReleases.push(() => resolve([]));
        }),
    );
    const runLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue(undefined);

    const firstProcess = trigger.processComposeFile('/opt/drydock/test/first.yml', [
      firstContainer,
    ]);
    await vi.waitFor(() => expect(applyReleases).toHaveLength(1));
    const secondProcess = trigger.processComposeFile('/opt/drydock/test/second.yml', [
      secondContainer,
    ]);
    await vi.waitFor(() => expect(applyReleases).toHaveLength(2));

    applyReleases.forEach((release) => release());
    await Promise.all([firstProcess, secondProcess]);

    expect(runLifecycleSpy).toHaveBeenCalledTimes(2);
    expect(runLifecycleSpy).toHaveBeenNthCalledWith(
      1,
      firstContainer,
      expect.any(Object),
      expect.objectContaining({
        lifecycleAlreadyAcquired: true,
        selfUpdateClassification: 'peer',
      }),
    );
    expect(runLifecycleSpy).toHaveBeenNthCalledWith(
      2,
      secondContainer,
      expect.any(Object),
      expect.objectContaining({
        lifecycleAlreadyAcquired: true,
        selfUpdateClassification: 'peer',
      }),
    );
    expect(applyReleases).toHaveLength(2);
  });

  test('processComposeFile should admit self-updates before mutating compose files', async () => {
    let releaseExclusive!: () => void;
    const exclusiveFinished = new Promise<void>((resolve) => {
      releaseExclusive = resolve;
    });
    const exclusive = withContainerUpdateLocks(
      ['test:self-compose-review'],
      async () => exclusiveFinished,
      { bypassGlobalCap: true, exclusive: true },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    try {
      trigger.configuration.dryrun = false;
      trigger.configuration.backup = false;
      const container = makeContainer({
        name: 'drydock',
        imageName: 'codeswhat/drydock',
        labels: { 'com.docker.compose.service': 'drydock' },
      });
      vi.spyOn(trigger, 'classifySelfUpdate').mockResolvedValue('current');
      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ drydock: { image: 'codeswhat/drydock:1.0.0' } }),
      );
      vi.spyOn(trigger, 'executeSelfUpdate').mockResolvedValue(false);
      const applyMutationsSpy = vi
        .spyOn(trigger, 'maybeApplyComposeFileMutations')
        .mockResolvedValue([]);

      const processPromise = trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(applyMutationsSpy).not.toHaveBeenCalled();

      releaseExclusive();
      await processPromise;
    } finally {
      releaseExclusive();
      await exclusive;
    }
  });

  test('processComposeFile should admit infrastructure helper updates before mutating compose files', async () => {
    let releaseExclusive!: () => void;
    const exclusiveFinished = new Promise<void>((resolve) => {
      releaseExclusive = resolve;
    });
    const exclusive = withContainerUpdateLocks(
      ['test:infrastructure-compose-review'],
      async () => exclusiveFinished,
      { bypassGlobalCap: true, exclusive: true },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    try {
      trigger.configuration.dryrun = false;
      trigger.configuration.backup = false;
      const container = makeContainer({
        labels: {
          'com.docker.compose.service': 'nginx',
          'dd.update.mode': 'infrastructure',
        },
      });
      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
      );
      vi.spyOn(trigger, 'executeSelfUpdate').mockResolvedValue(false);
      const applyMutationsSpy = vi
        .spyOn(trigger, 'maybeApplyComposeFileMutations')
        .mockResolvedValue([]);

      const processPromise = trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(applyMutationsSpy).not.toHaveBeenCalled();

      releaseExclusive();
      await processPromise;
    } finally {
      releaseExclusive();
      await exclusive;
    }
  });

  test('processComposeFile should hold same-project locks through mutation and rollback', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const firstContainer = makeContainer({
      labels: {
        'com.docker.compose.service': 'nginx',
        'com.docker.compose.project': 'shared',
      },
    });
    const secondContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      labels: {
        'com.docker.compose.service': 'redis',
        'com.docker.compose.project': 'shared',
      },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockImplementation(async (file) =>
      file.includes('first')
        ? makeCompose({ nginx: { image: 'nginx:1.0.0' } })
        : makeCompose({ redis: { image: 'redis:1.0.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockImplementation(async (file) =>
      Buffer.from(
        file.includes('first')
          ? ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')
          : ['services:', '  redis:', '    image: redis:1.0.0', ''].join('\n'),
      ),
    );
    let rejectFirstLifecycle!: (error: Error) => void;
    const lifecycleFinished = new Promise<never>((_resolve, reject) => {
      rejectFirstLifecycle = reject;
    });
    const runLifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle');
    runLifecycleSpy
      .mockImplementationOnce(() => lifecycleFinished)
      .mockResolvedValueOnce(undefined);
    const writes: string[] = [];
    vi.spyOn(trigger, 'writeComposeFile').mockImplementation(async (_file, text) => {
      writes.push(text);
    });

    const firstProcess = trigger.processComposeFile('/opt/drydock/test/first.yml', [
      firstContainer,
    ]);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const secondProcess = trigger.processComposeFile('/opt/drydock/test/second.yml', [
      secondContainer,
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toHaveLength(1);

    rejectFirstLifecycle(new Error('first runtime failed'));
    await expect(firstProcess).rejects.toThrow('first runtime failed');
    await secondProcess;
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('image: nginx:1.1.0');
    expect(writes[1]).toContain('image: nginx:1.0.0');
    expect(writes[2]).toContain('image: redis:1.1.0');
  });

  test('withContainerUpdateLocks should retain keyed locking when lifecycle admission is already held', async () => {
    const result = await withContainerUpdateLocks(
      ['compose-file:local:/opt/drydock/test/stack.yml'],
      async () => 'locked',
      { skipLifecycleGate: true },
    );

    expect(result).toBe('locked');
  });

  test('processComposeFile should hold same-file locks for unlabeled containers through rollback', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const firstContainer = makeContainer();
    const secondContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '1.0.0',
      remoteValue: '1.1.0',
    });
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
      redis: { image: 'redis:1.0.0' },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(compose);
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(
        [
          'services:',
          '  nginx:',
          '    image: nginx:1.0.0',
          '  redis:',
          '    image: redis:1.0.0',
          '',
        ].join('\n'),
      ),
    );
    let rejectFirstLifecycle!: (error: Error) => void;
    const lifecycleFinished = new Promise<never>((_resolve, reject) => {
      rejectFirstLifecycle = reject;
    });
    const runLifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle');
    runLifecycleSpy
      .mockImplementationOnce(() => lifecycleFinished)
      .mockResolvedValueOnce(undefined);
    const writes: string[] = [];
    vi.spyOn(trigger, 'writeComposeFile').mockImplementation(async (_file, text) => {
      writes.push(text);
    });

    const firstProcess = trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      firstContainer,
    ]);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const secondProcess = trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      secondContainer,
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toHaveLength(1);

    rejectFirstLifecycle(new Error('first runtime failed'));
    await expect(firstProcess).rejects.toThrow('first runtime failed');
    await secondProcess;
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('image: nginx:1.1.0');
    expect(writes[1]).toContain('image: nginx:1.0.0');
    expect(writes[2]).toContain('image: redis:1.1.0');
  });

  test('processComposeFile should serialize overlapping compose chains through rollback', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const firstContainer = makeContainer({ name: 'nginx-a' });
    const secondContainer = makeContainer({ name: 'nginx-b' });
    const compose = makeCompose({ nginx: { image: 'nginx:1.0.0' } });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockImplementation(async (file) =>
      String(file).endsWith('/base.yml') ? compose : makeCompose({}),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
    );
    let rejectFirstLifecycle!: (error: Error) => void;
    const lifecycleFinished = new Promise<never>((_resolve, reject) => {
      rejectFirstLifecycle = reject;
    });
    const runLifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle');
    runLifecycleSpy
      .mockImplementationOnce(() => lifecycleFinished)
      .mockResolvedValueOnce(undefined);
    const writes: string[] = [];
    vi.spyOn(trigger, 'writeComposeFile').mockImplementation(async (_file, text) => {
      writes.push(text);
    });

    const firstProcess = trigger.processComposeFile(
      '/opt/drydock/test/base.yml',
      [firstContainer],
      ['/opt/drydock/test/base.yml', '/opt/drydock/test/a.yml'],
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const secondProcess = trigger.processComposeFile(
      '/opt/drydock/test/base.yml',
      [secondContainer],
      ['/opt/drydock/test/base.yml', '/opt/drydock/test/b.yml'],
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(writes).toHaveLength(1);

    rejectFirstLifecycle(new Error('first overlapping chain failed'));
    await expect(firstProcess).rejects.toThrow('first overlapping chain failed');
    await secondProcess;
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('image: nginx:1.1.0');
    expect(writes[1]).toContain('image: nginx:1.0.0');
    expect(writes[2]).toContain('image: nginx:1.1.0');
  });

  test('processComposeFile should retain exclusive lifecycle after self handoff before later failure', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const selfContainer = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: { 'com.docker.compose.service': 'drydock' },
    });
    vi.spyOn(trigger, 'classifySelfUpdate').mockResolvedValue('current');
    const laterContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        drydock: { image: 'codeswhat/drydock:1.0.0' },
        nginx: { image: 'nginx:1.0.0' },
      }),
    );
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockResolvedValue([]);
    trigger.updateLifecycleExecutor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ updated: true, operationId: 'self-handoff' })
        .mockRejectedValueOnce(new Error('later service failed')),
    } as any;

    const queued = withContainerUpdateLocks([], async () => 'released');
    const processPromise = trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      selfContainer,
      laterContainer,
    ]);
    await expect(processPromise).rejects.toThrow('later service failed');
    expect(getUpdateLockSnapshot().lifecycle).toMatchObject({
      retainedExclusive: true,
      retainedOperationId: 'self-handoff',
    });

    releaseRetainedSelfUpdateLifecycle('self-handoff');
    await expect(queued).resolves.toBe('released');
  });

  test('processComposeFile should retain exclusive lifecycle after successful self handoff', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: { 'com.docker.compose.service': 'drydock' },
    });
    vi.spyOn(trigger, 'classifySelfUpdate').mockResolvedValue('current');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ drydock: { image: 'codeswhat/drydock:1.0.0' } }),
    );
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockResolvedValue([]);
    trigger.updateLifecycleExecutor = {
      run: vi.fn().mockResolvedValue({ updated: true, operationId: 'self-success' }),
    } as any;

    const queued = withContainerUpdateLocks([], async () => 'released');
    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).resolves.toBe(true);
    expect(getUpdateLockSnapshot().lifecycle).toMatchObject({
      retainedExclusive: true,
      retainedOperationId: 'self-success',
    });

    releaseRetainedSelfUpdateLifecycle('self-success');
    await expect(queued).resolves.toBe('released');
  });

  test('processComposeFile should retain exclusive lifecycle when self handoff throws directly', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: { 'com.docker.compose.service': 'drydock' },
    });
    vi.spyOn(trigger, 'classifySelfUpdate').mockResolvedValue('current');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ drydock: { image: 'codeswhat/drydock:1.0.0' } }),
    );
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockResolvedValue([]);
    trigger.updateLifecycleExecutor = {
      run: vi
        .fn()
        .mockRejectedValue(
          new RetainSelfUpdateLifecycleError('self-direct-retained', 'handoff callback failed'),
        ),
    } as any;

    const queued = withContainerUpdateLocks([], async () => 'released');
    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('handoff callback failed');
    expect(getUpdateLockSnapshot().lifecycle).toMatchObject({
      retainedExclusive: true,
      retainedOperationId: 'self-direct-retained',
    });

    releaseRetainedSelfUpdateLifecycle('self-direct-retained');
    await expect(queued).resolves.toBe('released');
  });

  test('processComposeFile should release infrastructure exclusivity after helper success', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      labels: {
        'com.docker.compose.service': 'nginx',
        'dd.update.mode': 'infrastructure',
      },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockResolvedValue([]);
    trigger.updateLifecycleExecutor = {
      run: vi.fn().mockResolvedValue({ updated: true, operationId: 'helper-success' }),
    } as any;

    const queued = withContainerUpdateLocks([], async () => 'released');
    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).resolves.toBe(true);
    await expect(queued).resolves.toBe('released');
    expect(getUpdateLockSnapshot().lifecycle).toBeUndefined();
  });

  test('processComposeFile should release infrastructure exclusivity after helper failure', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;
    const container = makeContainer({
      labels: {
        'com.docker.compose.service': 'nginx',
        'dd.update.mode': 'infrastructure',
      },
    });
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'maybeApplyComposeFileMutations').mockResolvedValue([]);
    trigger.updateLifecycleExecutor = {
      run: vi.fn().mockRejectedValue(new Error('helper failed')),
    } as any;

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('helper failed');
    expect(getUpdateLockSnapshot().lifecycle).toBeUndefined();
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

  test.each(['warn', 'off', 'block'])(
    'processComposeFile should refuse to rewrite a service whose repository differs from the runtime image (reconciliationMode=%s)',
    async (reconciliationMode) => {
      trigger.configuration.dryrun = false;
      trigger.configuration.backup = false;
      trigger.configuration.reconciliationMode = reconciliationMode;

      // The container claims service `db` through the compose label but runs a
      // different repository entirely. Rewriting `db.image` would repoint the
      // operator's stack file at this container's image.
      const container = makeContainer({
        tagValue: '1.20.0',
        remoteValue: '1.27.0',
        labels: { 'com.docker.compose.service': 'db' },
      });

      vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
        makeCompose({ db: { image: 'postgres:16' } }),
      );

      const { writeComposeFileSpy, composeUpdateSpy, backupSpy } =
        spyOnProcessComposeHelpers(trigger);

      await expect(
        trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
      ).rejects.toThrow('refusing to rewrite a different repository');

      expect(writeComposeFileSpy).not.toHaveBeenCalled();
      expect(composeUpdateSpy).not.toHaveBeenCalled();
      expect(backupSpy).not.toHaveBeenCalled();
    },
  );

  test('processComposeFile should update a docker.io/library alias instead of treating it as another repository', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.backup = false;

    const container = makeContainer({
      tagValue: '1.20.0',
      remoteValue: '1.27.0',
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'docker.io/library/nginx:1.20.0' } }),
    );

    const { writeComposeFileSpy } = spyOnProcessComposeHelpers(
      trigger,
      ['services:', '  nginx:', '    image: docker.io/library/nginx:1.20.0', ''].join('\n'),
    );

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: docker.io/nginx:1.27.0'),
    );
  });

  test('reconcileComposeMappings should accept a digest-pinned compose image for the same repository', () => {
    trigger.configuration.reconciliationMode = 'off';

    expect(() =>
      trigger.reconcileComposeMappings('stack.yml', [
        {
          container: { name: 'db' },
          service: 'db',
          runtimeImage: 'postgres:16',
          runtimeNormalized: 'postgres:16',
          current: 'postgres@sha256:0123456789abcdef',
          currentNormalized: 'postgres@sha256:0123456789abcdef',
        },
      ]),
    ).not.toThrow();
  });

  test('reconcileComposeMappings should resolve the raw image when no resolved image is supplied', () => {
    trigger.configuration.reconciliationMode = 'warn';

    expect(() =>
      trigger.reconcileComposeMappings('stack.yml', [
        {
          container: { name: 'nginx' },
          service: 'nginx',
          runtimeImage: 'nginx:1.0.0',
          runtimeNormalized: 'nginx:1.0.0',
          current: 'nginx:1.0.0',
          currentNormalized: 'nginx:1.0.0',
        },
      ]),
    ).not.toThrow();
  });

  test.each([
    ['names the container when the mapping carries one', { name: 'web' }, 'container web runs'],
    ['falls back when the mapping carries no container', undefined, 'container undefined runs'],
  ])(
    'reconcileComposeMappings repository guard %s',
    (_label, container, expectedMessageFragment) => {
      trigger.configuration.reconciliationMode = 'off';

      expect(() =>
        trigger.reconcileComposeMappings('stack.yml', [
          {
            container,
            service: 'db',
            runtimeImage: 'nginx:1.20.0',
            runtimeNormalized: 'nginx:1.20.0',
            current: 'postgres:16',
            currentNormalized: 'postgres:16',
          },
        ]),
      ).toThrow(expectedMessageFragment);
    },
  );

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
      expect.objectContaining({
        lifecycleAlreadyAcquired: true,
        selfUpdateClassification: 'peer',
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
