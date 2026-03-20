import { watch } from 'node:fs';
import yaml from 'yaml';
import { emitContainerUpdateApplied } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import Dockercompose, { testable_updateComposeServiceImageInText } from './Dockercompose.js';
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

  // Comment preservation
  // -----------------------------------------------------------------------

  test('updateComposeServiceImageInText should preserve commented-out service fields', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '    # ports:',
      '    #   - "8080:80"',
      '    # volumes:',
      '    #   - ./html:/usr/share/nginx/html',
      '    # environment:',
      '    #   - FOO=bar',
      '    restart: always',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('    # ports:');
    expect(updated).toContain('    #   - "8080:80"');
    expect(updated).toContain('    # volumes:');
    expect(updated).toContain('    #   - ./html:/usr/share/nginx/html');
    expect(updated).toContain('    # environment:');
    expect(updated).toContain('    #   - FOO=bar');
    expect(updated).toContain('    restart: always');
  });

  test('updateComposeServiceImageInText should preserve a commented-out entire service', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '  # redis:',
      '  #   image: redis:7',
      '  #   ports:',
      '  #     - "6379:6379"',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('  # redis:');
    expect(updated).toContain('  #   image: redis:7');
    expect(updated).toContain('  #   ports:');
    expect(updated).toContain('  #     - "6379:6379"');
  });

  test('updateComposeServiceImageInText should preserve top-level file comments', () => {
    const compose = [
      '# My production stack',
      '# Last updated: 2024-01-01',
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('# My production stack');
    expect(updated).toContain('# Last updated: 2024-01-01');
    expect(updated).toContain('    image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should preserve mixed inline and block comments', () => {
    const compose = [
      '# Stack header',
      'services:',
      '  nginx:',
      '    image: nginx:1.1.0 # web server',
      '    # ports:',
      '    #   - "80:80"',
      '    environment: # env vars',
      '      - NGINX_PORT=80 # default port',
      '  redis:',
      '    image: redis:7.0.0 # cache',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('# Stack header');
    expect(updated).toContain('    image: nginx:1.2.0 # web server');
    expect(updated).toContain('    # ports:');
    expect(updated).toContain('    #   - "80:80"');
    expect(updated).toContain('    environment: # env vars');
    expect(updated).toContain('      - NGINX_PORT=80 # default port');
    expect(updated).toContain('    image: redis:7.0.0 # cache');
  });

  // -----------------------------------------------------------------------
  // Image pruning after compose update
  // -----------------------------------------------------------------------

  test('processComposeFile should prune images after non-dryrun update when prune is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(pruneImagesSpy).toHaveBeenCalledWith(
      mockDockerApi,
      getState().registry.hub,
      container,
      expect.anything(),
    );
    expect(cleanupOldImagesSpy).toHaveBeenCalledWith(
      mockDockerApi,
      getState().registry.hub,
      container,
      expect.anything(),
    );
  });

  test('processComposeFile should not call pruneImages when prune is disabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // pruneImages is gated by prune config
    expect(pruneImagesSpy).not.toHaveBeenCalled();
    // cleanupOldImages is always called — it handles the prune check internally
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should skip pruneImages and post-update lifecycle in dryrun mode', async () => {
    trigger.configuration.dryrun = true;
    trigger.configuration.prune = true;

    const container = makeContainer();

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy, postHookSpy, rollbackMonitorSpy } =
      spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    // pruneImages is skipped in compose dryrun mode
    expect(pruneImagesSpy).not.toHaveBeenCalled();
    // cleanupOldImages is skipped (performContainerUpdate returns false in dryrun)
    expect(cleanupOldImagesSpy).not.toHaveBeenCalled();
    // Post-update hook is skipped in dryrun
    expect(postHookSpy).not.toHaveBeenCalled();
    // Rollback monitor is skipped in dryrun
    expect(rollbackMonitorSpy).not.toHaveBeenCalled();
    // No update event emitted
    expect(emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('processComposeFile should prune images for each container in a multi-container update', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(pruneImagesSpy).toHaveBeenCalledTimes(2);
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(2);
  });

  test('processComposeFile should parse compose update document only once for multi-service updates', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;

    const nginxContainer = makeContainer();
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    spyOnProcessComposeHelpers(trigger);
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(parseDocumentSpy).toHaveBeenCalledTimes(1);
  });

  test('processComposeFile should refresh each distinct service in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;

    const nginxContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(
        [
          'services:',
          '  nginx:',
          '    image: nginx:1.0.0',
          '  redis:',
          '    image: redis:7.0.0',
          '',
        ].join('\n'),
      ),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const runContainerUpdateLifecycleSpy = vi
      .spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(runContainerUpdateLifecycleSpy).toHaveBeenCalledTimes(2);
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      1,
      nginxContainer,
      expect.objectContaining({
        service: 'nginx',
        composeFileOnceApplied: false,
      }),
    );
    expect(runContainerUpdateLifecycleSpy).toHaveBeenNthCalledWith(
      2,
      redisContainer,
      expect.objectContaining({
        service: 'redis',
        composeFileOnceApplied: false,
      }),
    );
  });

  test('processComposeFile should pre-pull distinct services and skip per-service pull in compose-file-once mode', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = false;
    trigger.configuration.composeFileOnce = true;

    const nginxContainer = makeContainer({
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    const redisContainer = makeContainer({
      name: 'redis',
      imageName: 'redis',
      tagValue: '7.0.0',
      remoteValue: '7.1.0',
      labels: { 'com.docker.compose.service': 'redis' },
    });

    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from(
        [
          'services:',
          '  nginx:',
          '    image: nginx:1.0.0',
          '  redis:',
          '    image: redis:7.0.0',
          '',
        ].join('\n'),
      ),
    );
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    vi.spyOn(trigger, 'maybeScanAndGateUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'runPreUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'runPostUpdateHook').mockResolvedValue();
    vi.spyOn(trigger, 'cleanupOldImages').mockResolvedValue();
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [
      nginxContainer,
      redisContainer,
    ]);

    expect(pullImageSpy).toHaveBeenCalledTimes(2);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      nginxContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'redis',
      redisContainer,
      expect.objectContaining({
        skipPull: true,
      }),
    );
  });

  test('processComposeFile should prune images for digest-only updates when prune is enabled', async () => {
    trigger.configuration.dryrun = false;
    trigger.configuration.prune = true;

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
    const { pruneImagesSpy, cleanupOldImagesSpy } = spyOnProcessComposeHelpers(trigger);

    await trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]);

    expect(pruneImagesSpy).toHaveBeenCalledTimes(1);
    expect(cleanupOldImagesSpy).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
});
