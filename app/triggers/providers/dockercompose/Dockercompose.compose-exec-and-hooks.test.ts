import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getState } from '../../../registry/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { getCreatedContainerCandidate } from '../docker/created-container-candidate.js';
import Dockercompose from './Dockercompose.js';
import {
  makeCompose,
  makeContainer,
  makeDockerContainerHandle,
  makeExecMocks,
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
    vi.spyOn(trigger.getSecurityGate().securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: false,
    } as any);
  });

  // compose command execution
  // -----------------------------------------------------------------------

  test('updateContainerWithCompose should skip Docker API calls in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(mockLog.child).toHaveBeenCalledWith({ container: 'nginx' });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('dry-run mode is enabled'));
  });

  test('updateContainerWithCompose should pull and recreate the target service via Docker API', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(stopContainerSpy).toHaveBeenCalledTimes(1);
    expect(removeContainerSpy).toHaveBeenCalledTimes(1);
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
    expect(startContainerSpy).toHaveBeenCalledTimes(1);
  });

  test('updateContainerWithCompose should pin the image identity before the post-pull gate', async () => {
    trigger.configuration.dryrun = false;
    const targetReference = 'nginx:9.9.9';
    const localImageId = 'sha256:pulled-image';
    const pinnedIdentity = 'nginx:9.9.9@sha256:abcdef123456';
    const retaggedIdentity = 'sha256:retagged-image';
    const events: string[] = [];
    let retagged = false;

    mockDockerApi.getImage.mockImplementation((imageRef) => ({
      inspect: vi.fn().mockImplementation(async () => {
        if (imageRef === targetReference) {
          events.push(`inspect:${retagged ? 'retagged' : 'pulled'}`);
          return {
            Id: retagged ? retaggedIdentity : localImageId,
            RepoDigests: ['nginx@sha256:abcdef123456', 'foreign/nginx@sha256:deadbeef'],
            Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
            Os: 'linux',
            Config: { Env: [] },
          };
        }
        return { Architecture: process.arch === 'x64' ? 'amd64' : process.arch, Os: 'linux' };
      }),
    }));
    vi.spyOn(trigger, 'pullImage').mockImplementation(async () => {
      events.push('pull');
    });
    const gate = vi.fn().mockImplementation(async () => {
      events.push('gate');
      retagged = true;
    });
    const verifyCompatibilitySpy = vi
      .spyOn(trigger, 'verifyPulledImageCompatibility')
      .mockImplementation(async (_dockerApi, image) => {
        events.push(`compatibility:${image}`);
      });
    const cloneRuntimeConfigSpy = vi
      .spyOn(trigger.runtimeConfigManager, 'getCloneRuntimeConfigOptions')
      .mockImplementation(async (_dockerApi, _currentSpec, image) => {
        events.push(`config:${image}`);
        return {};
      });
    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockImplementation(async (_dockerApi, payload) => {
        events.push(`create:${payload.Image}`);
        return { start: vi.fn().mockResolvedValue(undefined) } as any;
      });

    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer({ name: 'nginx' }),
      {
        runtimeContext: {
          dockerApi: mockDockerApi,
          auth: {},
          newImage: targetReference,
        },
        postPullHook: gate,
      },
    );

    expect(events).toEqual([
      'pull',
      'inspect:pulled',
      'gate',
      `compatibility:${pinnedIdentity}`,
      `config:${pinnedIdentity}`,
      `create:${pinnedIdentity}`,
    ]);
    expect(gate).toHaveBeenCalledWith('', pinnedIdentity);
    expect(verifyCompatibilitySpy).toHaveBeenCalledWith(
      mockDockerApi,
      pinnedIdentity,
      expect.anything(),
      // This path pulled, so a failed inspect is still Docker's to report.
      { requireLocalImage: false },
    );
    expect(cloneRuntimeConfigSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.anything(),
      pinnedIdentity,
      expect.anything(),
    );
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: pinnedIdentity }),
      'nginx',
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should fail before mutation when the enabled gate lacks a matching manifest', async () => {
    trigger.configuration.dryrun = false;
    const securityGate = trigger.getSecurityGate();
    vi.spyOn(securityGate.securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: true },
      gate: { mode: 'on' },
    } as any);
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:local-image',
        RepoDigests: ['foreign/nginx@sha256:deadbeef'],
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopAndRemoveSpy = vi.spyOn(trigger, 'stopAndRemoveContainer');
    const createContainerSpy = vi.spyOn(trigger, 'createContainer');

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', makeContainer()),
    ).rejects.toThrow('Unable to bind security gate to the pulled image');

    expect(stopAndRemoveSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should bind the exact private repository digest', async () => {
    trigger.configuration.dryrun = false;
    const targetReference = 'registry.example:5000/team/app:2.0.0';
    const privateIdentity = 'registry.example:5000/team/app:2.0.0@sha256:abcdef123456';
    vi.spyOn(trigger.getSecurityGate().securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'block',
      signature: { verify: false },
      gate: { mode: 'on' },
    } as any);
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:private-image',
        RepoDigests: [
          'team/app@sha256:111111111111',
          'registry.example:5000/team/app@sha256:abcdef123456',
        ],
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const gate = vi.fn().mockResolvedValue(undefined);
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        runtimeContext: { dockerApi: mockDockerApi, auth: {}, newImage: targetReference },
        postPullHook: gate,
      },
    );

    expect(gate).toHaveBeenCalledWith('', privateIdentity);
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: privateIdentity }),
      'nginx',
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should preserve a matched digest-only repository identity', async () => {
    trigger.configuration.dryrun = false;
    const digestOnlyReference = 'registry.example:5000/team/app@sha256:abcdef123456';
    vi.spyOn(trigger.getSecurityGate().securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'block',
      signature: { verify: true },
      gate: { mode: 'on' },
    } as any);
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:digest-only-image',
        RepoDigests: ['other.example:5000/team/app@sha256:111111111111', digestOnlyReference],
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const gate = vi.fn().mockResolvedValue(undefined);
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        runtimeContext: { dockerApi: mockDockerApi, auth: {}, newImage: digestOnlyReference },
        postPullHook: gate,
      },
    );

    expect(gate).toHaveBeenCalledWith('', digestOnlyReference);
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: digestOnlyReference }),
      'nginx',
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should allow an unbound image under scan availability warn policy', async () => {
    trigger.configuration.dryrun = false;
    const securityGate = trigger.getSecurityGate();
    vi.spyOn(securityGate.securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    } as any);
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:local-image',
        RepoDigests: [],
      }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const postPullHook = vi.fn().mockResolvedValue(undefined);
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        runtimeContext: {
          dockerApi: mockDockerApi,
          auth: {},
          newImage: 'nginx:9.9.9',
        },
        postPullHook,
      },
    );

    // The gate half is suppressed because there is no immutable reference to
    // gate, but the hook also carries the deferred pre-update hook and the
    // prune/backup step, which still have to run before the replacement.
    expect(postPullHook).toHaveBeenCalledWith('', undefined, { skipSecurityGate: true });
    expect(securityAuditSpy).toHaveBeenCalledWith(
      'security-scan-skipped',
      expect.anything(),
      'error',
      'Security scan skipped because the pulled image could not be bound to an immutable digest; update allowed by DD_SECURITY_AVAILABILITY_POLICY=warn: Docker image inspection returned no local ID and matching manifest digest',
    );
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:9.9.9' }),
      'nginx',
      expect.anything(),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('proceeding without an immutable image reference'),
    );
  });

  test('compose-file-once refresh should proceed on a carried unbound warning with no post-pull hook', async () => {
    trigger.configuration.dryrun = false;
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    // The compose-file-once preflight already pulled, already recorded its own
    // verdict, and passes no post-pull hook to the per-service refresh.
    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        skipPull: true,
        runtimeContext: {
          dockerApi: mockDockerApi,
          auth: {},
          newImage: 'nginx:9.9.9',
          securityGateUnboundWarn: true,
          securityGateUnboundReason: 'manifest unavailable',
        },
      },
    );

    expect(securityAuditSpy).toHaveBeenCalledWith(
      'security-scan-skipped',
      expect.anything(),
      'error',
      expect.stringContaining('manifest unavailable'),
    );
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:9.9.9' }),
      'nginx',
      expect.anything(),
    );
  });

  test('recordUnboundSecurityWarning should use the binding fallback reason', () => {
    const securityAuditSpy = vi.spyOn(trigger, 'recordSecurityAudit');

    (trigger as any).recordUnboundSecurityWarning(makeContainer());

    expect(securityAuditSpy).toHaveBeenCalledWith(
      'security-scan-skipped',
      expect.objectContaining({ name: 'nginx' }),
      'error',
      'Security scan skipped because the pulled image could not be bound to an immutable digest; update allowed by DD_SECURITY_AVAILABILITY_POLICY=warn: unknown binding error',
    );
  });

  test('performContainerUpdate should scan after pull and before replacing the service', async () => {
    trigger.configuration.dryrun = false;
    const order: string[] = [];
    vi.spyOn(trigger, 'pullImage').mockImplementation(async () => {
      order.push('pull');
    });
    vi.spyOn(trigger, 'stopContainer').mockImplementation(async () => {
      order.push('stop');
    });
    vi.spyOn(trigger, 'removeContainer').mockImplementation(async () => {
      order.push('remove');
    });
    vi.spyOn(trigger, 'createContainer').mockImplementation(async () => {
      order.push('create');
      return { start: vi.fn().mockResolvedValue(undefined) } as any;
    });
    vi.spyOn(trigger, 'startContainer').mockImplementation(async () => {
      order.push('start');
    });
    vi.spyOn(trigger, 'runServicePostStartHooks').mockImplementation(async () => {
      order.push('postStart');
    });
    const postPullHook = vi.fn().mockImplementation(async () => {
      order.push('postPull');
    });
    const container = makeContainer({ name: 'nginx' });

    await trigger.performContainerUpdate(
      {
        dockerApi: mockDockerApi,
        auth: {},
        newImage: 'nginx:9.9.9',
        registry: getState().registry.hub,
      },
      container,
      mockLog,
      {
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: {},
        composeFileOnceApplied: false,
        runtimeContext: { operationId: 'op-compose-order' },
      },
      postPullHook,
    );

    expect(order).toEqual(['pull', 'postPull', 'stop', 'remove', 'create', 'start', 'postStart']);
    expect(postPullHook).toHaveBeenCalledTimes(1);
    expect(postPullHook).toHaveBeenCalledWith('op-compose-order');
  });

  test('performContainerUpdate should invoke the scan once without Docker mutation in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const postStartHookSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const postPullHook = vi.fn().mockResolvedValue(undefined);

    const updated = await trigger.performContainerUpdate(
      {
        dockerApi: mockDockerApi,
        auth: {},
        newImage: 'nginx:9.9.9',
        registry: getState().registry.hub,
      },
      makeContainer({ name: 'nginx' }),
      mockLog,
      {
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: {},
        composeFileOnceApplied: false,
        runtimeContext: { operationId: 'op-compose-dryrun' },
      },
      postPullHook,
    );

    expect(updated).toBe(false);
    expect(postPullHook).toHaveBeenCalledTimes(1);
    expect(postPullHook).toHaveBeenCalledWith('op-compose-dryrun');
    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(removeContainerSpy).not.toHaveBeenCalled();
    expect(postStartHookSpy).toHaveBeenCalledTimes(1);
    expect(postStartHookSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nginx' }),
      'nginx',
      {},
    );
  });

  test('performContainerUpdate should leave the existing service untouched when the scan blocks', async () => {
    trigger.configuration.dryrun = false;
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    const postStartHookSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const postPullHook = vi.fn().mockRejectedValue(new Error('scan blocked'));
    const container = makeContainer({ name: 'nginx' });

    await expect(
      trigger.performContainerUpdate(
        {
          dockerApi: mockDockerApi,
          auth: {},
          newImage: 'nginx:9.9.9',
          registry: getState().registry.hub,
        },
        container,
        mockLog,
        {
          composeFile: '/opt/drydock/test/stack.yml',
          service: 'nginx',
          serviceDefinition: {},
          composeFileOnceApplied: false,
        },
        postPullHook,
      ),
    ).rejects.toThrow('scan blocked');

    expect(postPullHook).toHaveBeenCalledTimes(1);
    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(removeContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
    expect(startContainerSpy).not.toHaveBeenCalled();
    expect(postStartHookSpy).not.toHaveBeenCalled();
  });

  test('performContainerUpdate should recreate a replica already refreshed by compose-file-once mode, reusing its bound identity', async () => {
    trigger.configuration.dryrun = false;
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const postPullHook = vi.fn().mockResolvedValue(undefined);
    const container = makeContainer({ id: 'container-once', name: 'nginx' });

    const updated = await trigger.performContainerUpdate(
      {} as any,
      container,
      mockLog,
      {
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: {},
        composeFileOnceApplied: true,
        runtimeContext: { operationId: 'op-compose-once' },
      },
      postPullHook,
    );

    expect(updated).toBe(true);
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      expect.objectContaining({
        runtimeContext: expect.objectContaining({ operationId: 'op-compose-once' }),
        postPullHook,
      }),
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Recreate nginx for compose-file-once service nginx'),
    );
  });

  test('performContainerUpdate should allow a compose-file-once replica refresh without a post-pull hook', async () => {
    trigger.configuration.dryrun = false;
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const container = makeContainer({ id: 'container-no-hook', name: 'nginx' });

    await trigger.performContainerUpdate({} as any, container, mockLog, {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'nginx',
      serviceDefinition: {},
      composeFileOnceApplied: true,
    });

    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      expect.not.objectContaining({ postPullHook: expect.anything() }),
    );
  });

  test('performContainerUpdate should not forward the hook to the compose refresh when the post-pull gate already completed', async () => {
    trigger.configuration.dryrun = false;
    const updateContainerWithComposeSpy = vi
      .spyOn(trigger, 'updateContainerWithCompose')
      .mockResolvedValue();
    vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const postPullHook = vi.fn().mockResolvedValue(undefined);
    const container = makeContainer({ id: 'container-gated', name: 'nginx' });

    await trigger.performContainerUpdate(
      {} as any,
      container,
      mockLog,
      {
        composeFile: '/opt/drydock/test/stack.yml',
        service: 'nginx',
        serviceDefinition: {},
        composeFileOnceApplied: true,
        postPullGateCompleted: true,
      },
      postPullHook,
    );

    expect(postPullHook).not.toHaveBeenCalled();
    expect(updateContainerWithComposeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      'nginx',
      container,
      expect.not.objectContaining({ postPullHook: expect.anything() }),
    );
  });

  test('buildComposeRuntimeContext should retain the pulled image identity', () => {
    const imageIdentity = 'nginx:1.1.0@sha256:abcdef123456';

    expect(
      (trigger as any).buildComposeRuntimeContext(
        { imageIdentity },
        { composeFile: '/opt/drydock/test/stack.yml', service: 'nginx' },
      ),
    ).toEqual({ imageIdentity });
  });

  test('compose-file-once preflight should carry an unbound-image warning into its runtime context', async () => {
    trigger.configuration.dryrun = false;
    const securityGate = trigger.getSecurityGate();
    vi.spyOn(securityGate.securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'warn',
      signature: { verify: false },
      gate: { mode: 'on' },
    } as any);
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:local-image', RepoDigests: [] }),
    });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();

    const result = await (trigger as any).buildComposeFileOnceRuntimeContextByService([
      { service: 'nginx', container: makeContainer() },
    ]);

    expect(result.get('nginx')).toEqual(
      expect.objectContaining({
        securityGateUnboundWarn: true,
        securityGateUnboundReason: expect.any(String),
      }),
    );
  });

  test('compose-file-once post-pull gate should fail when its update context cannot be created', async () => {
    vi.spyOn(trigger, 'createTriggerContext').mockResolvedValue(undefined);

    await expect(
      (trigger as any).runComposeFileOncePostPullGate(makeContainer(), {
        service: 'nginx',
        runtimeContext: {},
      }),
    ).rejects.toThrow('Unable to create update context for compose service nginx');
  });

  test('compose-file-once post-pull gate should record an allowed unbound security warning', async () => {
    const recordWarningSpy = vi.spyOn(trigger, 'recordUnboundSecurityWarning');
    vi.spyOn(trigger, 'createTriggerContext').mockResolvedValue({} as any);

    await (trigger as any).runComposeFileOncePostPullGate(makeContainer(), {
      service: 'nginx',
      runtimeContext: {
        securityGateUnboundWarn: true,
        securityGateUnboundReason: 'manifest unavailable',
      },
    });

    expect(recordWarningSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nginx' }),
      'manifest unavailable',
    );
  });

  test('compose-file-once post-pull gate should update operation phase while scanning', async () => {
    const updateOperationSpy = vi
      .spyOn(updateOperationStore, 'updateOperation')
      .mockReturnValue({} as any);
    vi.spyOn(trigger, 'createTriggerContext').mockResolvedValue({} as any);
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockImplementation(
      async (_context, _container, _log, options) => {
        options?.setPhase?.('scanning');
      },
    );

    await (trigger as any).runComposeFileOncePostPullGate(makeContainer(), {
      service: 'nginx',
      runtimeContext: { operationId: 'op-compose-gate' },
    });

    expect(updateOperationSpy).toHaveBeenCalledWith('op-compose-gate', { phase: 'scanning' });
  });

  test('compose-file-once post-pull gate should ignore phase updates without an operation id', async () => {
    const updateOperationSpy = vi
      .spyOn(updateOperationStore, 'updateOperation')
      .mockReturnValue({} as any);
    vi.spyOn(trigger, 'createTriggerContext').mockResolvedValue({} as any);
    vi.spyOn(trigger, 'verifySignaturePreUpdate').mockResolvedValue();
    vi.spyOn(trigger, 'scanAndGatePostPull').mockImplementation(
      async (_context, _container, _log, options) => {
        options?.setPhase?.('scanning');
      },
    );

    await (trigger as any).runComposeFileOncePostPullGate(makeContainer(), {
      service: 'nginx',
      runtimeContext: {},
    });

    expect(updateOperationSpy).not.toHaveBeenCalled();
  });

  test('capturePulledImageIdentity should ignore malformed repository digests', async () => {
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:local-image',
        RepoDigests: ['nginx', '@sha256:bad', 'nginx@not-a-digest'],
      }),
    });

    await expect(
      (trigger as any).capturePulledImageIdentity(
        mockDockerApi,
        'nginx:1.1.0',
        makeContainer(),
        mockLog,
      ),
    ).resolves.toEqual({ unboundWarn: false, localImageId: 'sha256:local-image' });
  });

  test('capturePulledImageIdentity should use the missing-identity policy when inspection fails', async () => {
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
    });

    await expect(
      (trigger as any).capturePulledImageIdentity(
        mockDockerApi,
        'nginx:1.1.0',
        makeContainer(),
        mockLog,
      ),
    ).resolves.toEqual({ unboundWarn: false });
  });

  test('pulled image repository candidates should handle missing paths and library aliases', () => {
    expect((trigger as any).getPulledImageRepositoryCandidates({})).toEqual([]);
    expect(
      (trigger as any).getPulledImageRepositoryCandidates({
        domain: 'docker.io',
        path: 'library/nginx',
      }),
    ).toContain('nginx');
    expect(
      (trigger as any).getPulledImageRepositoryCandidates({
        domain: 'index.docker.io',
        path: 'library/nginx',
      }),
    ).toContain('nginx');
  });

  test('post-pull identity binding should disable the gate when security execution is unavailable', () => {
    const securityGate = trigger.getSecurityGate() as any;
    vi.spyOn(securityGate.securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'block',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    vi.spyOn(securityGate, 'shouldRunSecurityGate').mockReturnValue(false);

    expect((trigger as any).getPostPullIdentityBindingPolicy(makeContainer())).toBe('disabled');
  });

  test('post-pull identity binding should disable the gate when its effective mode is off', () => {
    const securityGate = trigger.getSecurityGate() as any;
    vi.spyOn(securityGate.securityConfig, 'getSecurityConfiguration').mockReturnValue({
      enabled: true,
      availabilityPolicy: 'block',
      signature: { verify: false },
      gate: { mode: 'on' },
    });
    vi.spyOn(securityGate, 'getEffectiveGateMode').mockReturnValue('off');

    expect((trigger as any).getPostPullIdentityBindingPolicy(makeContainer())).toBe('disabled');
  });

  test('compose-file-once runtime updates should preserve requested context without a preflight context', async () => {
    trigger.configuration.composeFileOnce = true;
    trigger.configuration.dryrun = false;
    const lifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockResolvedValue();
    const container = makeContainer({ labels: { 'com.docker.compose.service': 'nginx' } });

    await (trigger as any).runRuntimeUpdatesForComposeMappings(
      '/opt/drydock/test/stack.yml',
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: {} }),
      [{ service: 'nginx', container }],
      { operationId: 'op-compose-context' },
    );

    expect(lifecycleSpy).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ runtimeContext: { operationId: 'op-compose-context' } }),
      expect.objectContaining({ lifecycleAlreadyAcquired: false }),
    );
  });

  test('compose-file-once runtime updates should still gate a service the preflight did not cover', async () => {
    trigger.configuration.composeFileOnce = true;
    trigger.configuration.dryrun = false;
    const { scanAndGateSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);
    const container = makeContainer({ labels: { 'com.docker.compose.service': 'nginx' } });

    await (trigger as any).runRuntimeUpdatesForComposeMappings(
      '/opt/drydock/test/stack.yml',
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: {} }),
      [{ service: 'nginx', container }],
    );

    // No preflight context for this service, so the ordinary gated path has to
    // run rather than the batch claiming the gate was already completed.
    expect(scanAndGateSpy).toHaveBeenCalledTimes(1);
    const composeUpdateOptions = composeUpdateSpy.mock.calls[0][3];
    expect(composeUpdateOptions.postPullHook).toEqual(expect.any(Function));
    expect(composeUpdateOptions.skipPull).toBeUndefined();
  });

  test('compose-file-once runtime updates should gate every replica of a service the preflight did not cover', async () => {
    trigger.configuration.composeFileOnce = true;
    trigger.configuration.dryrun = false;
    const { scanAndGateSpy, composeUpdateSpy } = spyOnProcessComposeHelpers(trigger);
    const labels = { 'com.docker.compose.service': 'nginx' };
    const first = makeContainer({ id: 'nginx-1', name: 'nginx-1', labels });
    const second = makeContainer({ id: 'nginx-2', name: 'nginx-2', labels });

    await (trigger as any).runRuntimeUpdatesForComposeMappings(
      '/opt/drydock/test/stack.yml',
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: {} }),
      [
        { service: 'nginx', container: first },
        { service: 'nginx', container: second },
      ],
    );

    // Compose-file-once only earns the one-refresh-per-service shortcut off a
    // preflight. Without one, marking the service handled after the first
    // replica would make the second wrongly skip its own compose refresh,
    // assuming the first replica's refresh already covered it. It would
    // still be gated, through the postPullHook fallback that runs whenever
    // postPullGateCompleted is false, but it would never get pulled or
    // recreated.
    expect(composeUpdateSpy).toHaveBeenCalledTimes(2);
    expect(scanAndGateSpy).toHaveBeenCalledTimes(2);
  });

  test('compose-file-once runtime updates should omit runtime context when neither context is available', async () => {
    trigger.configuration.composeFileOnce = true;
    trigger.configuration.dryrun = false;
    const lifecycleSpy = vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockResolvedValue();
    const container = makeContainer({ labels: { 'com.docker.compose.service': 'nginx' } });

    await (trigger as any).runRuntimeUpdatesForComposeMappings(
      '/opt/drydock/test/stack.yml',
      ['/opt/drydock/test/stack.yml'],
      makeCompose({ nginx: {} }),
      [{ service: 'nginx', container }],
    );

    expect(lifecycleSpy).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ runtimeContext: undefined }),
      expect.objectContaining({ lifecycleAlreadyAcquired: false }),
    );
  });

  test('dry-run compose refresh should invoke the post-pull hook without Docker mutation', async () => {
    const postPullHook = vi.fn().mockResolvedValue(undefined);

    await (trigger as any).refreshComposeServiceWithDockerApi(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      { postPullHook },
    );

    expect(postPullHook).toHaveBeenCalledWith('');
    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('compose refresh should reuse a supplied image identity without recapturing it', async () => {
    trigger.configuration.dryrun = false;
    const imageIdentity = 'nginx:1.1.0@sha256:abcdef123456';
    const captureIdentitySpy = vi.spyOn(trigger as any, 'capturePulledImageIdentity');
    vi.spyOn(trigger, 'verifyPulledImageCompatibility').mockResolvedValue();
    vi.spyOn(trigger.runtimeConfigManager, 'getCloneRuntimeConfigOptions').mockResolvedValue({});
    vi.spyOn(trigger as any, 'recreateReplacementContainerWithCleanup').mockResolvedValue();
    const postPullHook = vi.fn().mockResolvedValue(undefined);

    await (trigger as any).refreshComposeServiceWithDockerApi(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        runtimeContext: {
          dockerApi: mockDockerApi,
          auth: {},
          newImage: 'nginx:1.1.0',
          imageIdentity,
        },
        postPullHook,
      },
    );

    expect(captureIdentitySpy).not.toHaveBeenCalled();
    expect(postPullHook).toHaveBeenCalledWith('', imageIdentity);
  });

  test('updateContainerWithCompose should remove stale image-inherited env defaults while preserving runtime env', async () => {
    trigger.configuration.dryrun = false;
    const currentContainer = makeDockerContainerHandle({
      image: 'example/app:old',
    });
    currentContainer.inspect.mockResolvedValue({
      Id: 'container-id',
      Name: '/nginx',
      Config: {
        Image: 'example/app:old',
        Env: ['APP_VERSION=old', 'RUNTIME_VALUE=keep'],
        Labels: {},
      },
      HostConfig: {},
      NetworkSettings: { Networks: {} },
      State: { Running: true },
    });
    mockDockerApi.getContainer.mockReturnValue(currentContainer);
    mockDockerApi.getImage.mockImplementation((imageRef) => ({
      inspect: vi.fn().mockResolvedValue(
        imageRef === 'example/app:old'
          ? { Config: { Env: ['APP_VERSION=old'] } }
          : {
              Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
              Os: 'linux',
              Config: { Env: ['APP_VERSION=new'] },
            },
      ),
    }));
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.updateContainerWithCompose(
      '/opt/drydock/test/stack.yml',
      'nginx',
      makeContainer(),
      {
        skipPull: true,
        runtimeContext: {
          dockerApi: mockDockerApi,
          newImage: 'example/app:new',
        },
      },
    );

    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({
        Env: ['RUNTIME_VALUE=keep'],
      }),
      'nginx',
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should preserve stopped runtime state', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const startContainerSpy = vi.spyOn(trigger, 'startContainer').mockResolvedValue();
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(
      makeDockerContainerHandle({
        running: false,
      }),
    );
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);

    expect(pullImageSpy).toHaveBeenCalledTimes(1);
    expect(startContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should skip pull when requested and still recreate', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const container = makeContainer({ name: 'nginx' });

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      shouldStart: true,
      skipPull: true,
      forceRecreate: true,
    });

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
  });

  test('updateContainerWithCompose should ignore compose file chain and use Docker API path', async () => {
    trigger.configuration.dryrun = false;
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const container = makeContainer({ name: 'nginx' });
    const composeFiles = ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'];

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      shouldStart: true,
      skipPull: true,
      composeFiles,
    });

    expect(pullImageSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should reuse runtime context without resolving registry manager', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const resolveRegistryManagerSpy = vi.spyOn(trigger, 'resolveRegistryManager');
    const getWatcherSpy = vi.spyOn(trigger, 'getWatcher');
    const runtimeContext = {
      dockerApi: mockDockerApi,
      auth: { from: 'context' },
      newImage: 'nginx:9.9.9',
    };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      runtimeContext,
    });

    expect(resolveRegistryManagerSpy).not.toHaveBeenCalled();
    expect(getWatcherSpy).not.toHaveBeenCalled();
    expect(pullImageSpy).toHaveBeenCalledWith(
      runtimeContext.dockerApi,
      runtimeContext.auth,
      runtimeContext.newImage,
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should fetch auth when runtime context provides newImage without auth', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const resolveRegistryManagerSpy = vi.spyOn(trigger, 'resolveRegistryManager');
    const getNewImageFullNameSpy = vi.spyOn(trigger, 'getNewImageFullName');
    const registryGetAuthPull = vi.fn().mockResolvedValue({ from: 'registry-auth' });
    const runtimeContext = {
      dockerApi: mockDockerApi,
      newImage: 'nginx:9.9.9',
      registry: {
        getAuthPull: registryGetAuthPull,
      },
    };

    await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container, {
      runtimeContext,
    });

    expect(resolveRegistryManagerSpy).not.toHaveBeenCalled();
    expect(getNewImageFullNameSpy).not.toHaveBeenCalled();
    expect(registryGetAuthPull).toHaveBeenCalledTimes(1);
    expect(pullImageSpy).toHaveBeenCalledWith(
      runtimeContext.dockerApi,
      { from: 'registry-auth' },
      runtimeContext.newImage,
      expect.anything(),
    );
  });

  test('updateContainerWithCompose should throw when current container cannot be resolved', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(undefined);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow(
      'Unable to refresh compose service nginx from /opt/drydock/test/stack.yml because container nginx no longer exists',
    );
  });

  test('updateContainerWithCompose should surface pullImage failures and stop before recreation', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockRejectedValue(new Error('pull failed'));
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('pull failed');

    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should surface stopAndRemoveContainer failures and skip recreation', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockRejectedValue(new Error('stop failed'));
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('stop failed');

    expect(createContainerSpy).not.toHaveBeenCalled();
  });

  test('updateContainerWithCompose should surface recreateContainer failures', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer').mockRejectedValue(new Error('create failed'));

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('create failed');
  });

  // Regression coverage for #391 rollback safety net.
  // -----------------------------------------------------------------------

  test('[#391] updateContainerWithCompose should attempt to restore old container when recreateContainer throws', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();

    // First createContainer call fails (new image creation), second succeeds (rollback restore).
    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockRejectedValueOnce(new Error('No such image: nginx:1.1.0'))
      .mockResolvedValueOnce({ start: vi.fn().mockResolvedValue(undefined) } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('No such image: nginx:1.1.0');

    // createContainer is called twice: once for the new image, once for the rollback restore.
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempting to restore the original container from captured spec'),
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('restored successfully after failed update'),
    );
  });

  test('updateContainerWithCompose should remove a created replacement candidate before rollback restore when start fails', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const failedCandidate = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const restoredContainer = {
      start: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockResolvedValueOnce(failedCandidate as any)
      .mockResolvedValueOnce(restoredContainer as any);
    vi.spyOn(trigger, 'startContainer')
      .mockRejectedValueOnce(new Error('start failed'))
      .mockResolvedValueOnce(undefined);

    let thrownError: any;
    try {
      await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('start failed');
    expect(thrownError.composeRollbackOutcome).toEqual({
      status: 'rolled-back',
      phase: 'rolled-back',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: 'start failed',
    });
    expect(failedCandidate.remove).toHaveBeenCalledWith({ force: true });
    expect(failedCandidate.remove.mock.invocationCallOrder[0]).toBeLessThan(
      createContainerSpy.mock.invocationCallOrder[1],
    );
  });

  test('updateContainerWithCompose should stop and force-remove the orphan created by a failed rollback-restore attempt', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    const orphanedRestoreCandidate = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();

    // First createContainer call (new image) fails outright, triggering the
    // rollback-restore safety net. The rollback-restore's own createContainer
    // call succeeds, but its subsequent startContainer fails — this exercises
    // the REAL Docker.recreateContainer behavior (via super.recreateContainer),
    // so the created-but-unstarted container is actually attached to the
    // thrown error via attachCreatedContainerCandidate, not a stubbed one.
    vi.spyOn(trigger, 'createContainer')
      .mockRejectedValueOnce(new Error('No such image: nginx:1.1.0'))
      .mockResolvedValueOnce(orphanedRestoreCandidate as any);
    vi.spyOn(trigger, 'startContainer').mockRejectedValueOnce(new Error('rollback start failed'));

    let thrownError: any;
    try {
      await trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('No such image: nginx:1.1.0');
    expect(thrownError.composeRollbackOutcome).toEqual({
      status: 'rollback-failed',
      phase: 'rollback-failed',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: 'No such image: nginx:1.1.0',
    });
    expect(orphanedRestoreCandidate.stop).toHaveBeenCalledTimes(1);
    expect(orphanedRestoreCandidate.remove).toHaveBeenCalledWith({ force: true });
  });

  test('updateContainerWithCompose should remove a network-attach replacement candidate before rollback restore', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ id: 'old-id', name: 'nginx' });
    const currentContainer = makeDockerContainerHandle({ id: 'old-id', name: 'nginx' });
    const failedCandidate = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const restoredContainer = {
      start: vi.fn().mockResolvedValue(undefined),
    };
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('network attach failed'))
      .mockResolvedValueOnce(undefined);

    mockDockerApi.getContainer.mockReturnValueOnce(currentContainer);
    mockDockerApi.getNetwork.mockReturnValue({ connect });
    mockDockerApi.createContainer
      .mockResolvedValueOnce(failedCandidate as any)
      .mockResolvedValueOnce(restoredContainer as any);
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Id: 'old-id',
      Name: '/nginx',
      Config: { Image: 'nginx:1.0.0', Env: [], Labels: {} },
      HostConfig: { AutoRemove: false, NetworkMode: 'bridge' },
      NetworkSettings: {
        Networks: {
          bridge: { Aliases: ['old-id'] },
          sidecar: { Aliases: ['old-id'] },
        },
      },
      State: { Running: true },
    } as any);
    vi.spyOn(trigger, 'startContainer').mockResolvedValue(undefined);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('network attach failed');

    expect(failedCandidate.remove).toHaveBeenCalledWith({ force: true });
    expect(failedCandidate.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mockDockerApi.createContainer.mock.invocationCallOrder[1],
    );
  });

  test('createContainer exposes a network-attach candidate through the shared rollback channel only', async () => {
    const failedCandidate = makeDockerContainerHandle();
    const networkError = new Error('network attach failed');
    mockDockerApi.createContainer.mockResolvedValue(failedCandidate);
    mockDockerApi.getNetwork.mockReturnValue({
      connect: vi.fn().mockRejectedValue(networkError),
    });

    await expect(
      trigger.createContainer(
        mockDockerApi,
        {
          NetworkingConfig: {
            EndpointsConfig: {
              bridge: {},
              sidecar: {},
            },
          },
        },
        'nginx',
        mockLog,
      ),
    ).rejects.toBe(networkError);

    expect(getCreatedContainerCandidate(networkError)).toBe(failedCandidate);
    expect(
      (networkError as Error & { composeCreatedContainerCandidate?: unknown })
        .composeCreatedContainerCandidate,
    ).toBeUndefined();
  });

  test('[#391] updateContainerWithCompose should rethrow original error even when rollback restore also fails', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();

    // Both createContainer calls fail: new image and rollback restore.
    vi.spyOn(trigger, 'createContainer')
      .mockRejectedValueOnce(new Error('No such image: nginx:1.1.0'))
      .mockRejectedValueOnce(new Error('restore failed'));

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('No such image: nginx:1.1.0');

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempting to restore the original container from captured spec'),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Manual intervention may be required'),
    );
  });

  test('[#391] updateContainerWithCompose should fall back to newImage when currentContainerSpec has no Config.Image', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();

    // Provide a spec without Config.Image to cover the `?? newImage` fallback branch.
    vi.spyOn(trigger, 'getCurrentContainer').mockResolvedValue(
      makeDockerContainerHandle({ name: 'nginx' }),
    );
    vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Id: 'container-id',
      Name: '/nginx',
      State: { Running: true },
      HostConfig: { AutoRemove: false },
      NetworkSettings: { Networks: {} },
      Config: { Env: [], Labels: {} }, // no Image field
    } as any);

    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ start: vi.fn().mockResolvedValue(undefined) } as any);

    // Should still attempt rollback using newImage as fallback.
    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('create failed');

    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempting to restore the original container from captured spec'),
    );
  });

  test('[#391] updateContainerWithCompose should NOT call stopAndRemoveContainer when pre-flight arch check fails', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();

    // Simulate an image with arm/v6 (arm) architecture on an amd64 host.
    const incompatibleArch = process.arch === 'arm' ? 'amd64' : 'arm';
    mockDockerApi.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Architecture: incompatibleArch, Os: 'linux' }),
    });

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow('is not compatible with Docker daemon architecture');

    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(removeContainerSpy).not.toHaveBeenCalled();
  });

  test('[#391] verifyPulledImageCompatibility should skip check when dockerApi has no getImage', async () => {
    const apiWithoutGetImage = { modem: { socketPath: '/var/run/docker.sock' } } as any;
    // Should not throw — treat as compatible.
    await expect(
      trigger.verifyPulledImageCompatibility(apiWithoutGetImage, 'nginx:1.1.0', mockLog),
    ).resolves.toBeUndefined();
  });

  test('[#391] verifyPulledImageCompatibility should skip check when image inspect throws', async () => {
    const failingApi = {
      modem: { socketPath: '/var/run/docker.sock' },
      getImage: vi.fn().mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('image not found')),
      }),
    } as any;
    await expect(
      trigger.verifyPulledImageCompatibility(failingApi, 'nginx:1.1.0', mockLog),
    ).resolves.toBeUndefined();
  });

  test('[#391] verifyPulledImageCompatibility should skip check when image inspect returns no Architecture', async () => {
    const apiNoArch = {
      modem: { socketPath: '/var/run/docker.sock' },
      getImage: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Os: 'linux' }),
      }),
    } as any;
    await expect(
      trigger.verifyPulledImageCompatibility(apiNoArch, 'nginx:1.1.0', mockLog),
    ).resolves.toBeUndefined();
  });

  test('[#391] verifyPulledImageCompatibility should skip check for unknown/exotic architectures', async () => {
    const apiExoticArch = {
      modem: { socketPath: '/var/run/docker.sock' },
      getImage: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Architecture: 'loongarch64', Os: 'linux' }),
      }),
    } as any;
    // Should not throw for unknown architectures (treat as compatible).
    await expect(
      trigger.verifyPulledImageCompatibility(apiExoticArch, 'nginx:1.1.0', mockLog),
    ).resolves.toBeUndefined();
  });

  test('verifyPulledImageCompatibility compares against the Docker daemon architecture for remote watchers', async () => {
    const remoteDockerArch = process.arch === 'x64' ? 'arm64' : 'amd64';
    const remoteDaemonArch = remoteDockerArch === 'amd64' ? 'x86_64' : remoteDockerArch;
    const remoteApi = {
      modem: { socketPath: '/var/run/docker.sock' },
      info: vi.fn().mockResolvedValue({ Architecture: remoteDaemonArch }),
      getImage: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Architecture: remoteDockerArch, Os: 'linux' }),
      }),
    } as any;

    await expect(
      trigger.verifyPulledImageCompatibility(remoteApi, 'nginx:1.1.0', mockLog),
    ).resolves.toBeUndefined();
  });

  test('[#391] verifyPulledImageCompatibility should log compatibility on successful check', async () => {
    const hostCompatibleArch = process.arch === 'x64' ? 'amd64' : process.arch;
    const hostDaemonArch = hostCompatibleArch === 'amd64' ? 'x86_64' : hostCompatibleArch;
    const compatibleApi = {
      modem: { socketPath: '/var/run/docker.sock' },
      info: vi.fn().mockResolvedValue({ Architecture: hostDaemonArch }),
      getImage: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Architecture: hostCompatibleArch, Os: 'linux' }),
      }),
    } as any;
    await trigger.verifyPulledImageCompatibility(compatibleApi, 'nginx:1.1.0', mockLog);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining(`architecture "${hostCompatibleArch}" is compatible`),
    );
  });

  test('updateContainerWithCompose should throw when inspectContainer returns malformed runtime state', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx' });
    vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Config: { Image: 'nginx:1.0.0' },
    } as any);

    await expect(
      trigger.updateContainerWithCompose('/opt/drydock/test/stack.yml', 'nginx', container),
    ).rejects.toThrow(
      'Unable to refresh compose service nginx from /opt/drydock/test/stack.yml because Docker inspection data is missing runtime state',
    );
  });

  test('stopAndRemoveContainer should be a no-op with compose lifecycle log', async () => {
    await trigger.stopAndRemoveContainer({}, {}, { name: 'nginx' }, mockLog);

    expect(mockLog.info).toHaveBeenCalledWith(
      'Skip direct stop/remove for compose-managed container nginx; using compose lifecycle',
    );
  });

  test('recreateContainer should rewrite compose service image without routing through updateContainerWithCompose', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    # existing comment',
      '    image: nginx:1.1.0 # old image',
      '',
    ].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose');
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: false },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.0.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('# existing comment'),
    );
    expect(composeUpdateSpy).not.toHaveBeenCalled();
  });

  test('recreateContainer should reject a labeled service with a different image repository before mutation', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'db',
      },
    });
    const composeFileContent = ['services:', '  db:', '    image: postgres:16', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ db: { image: 'postgres:16' } }),
    );

    await expect(
      trigger.recreateContainer(
        mockDockerApi,
        {
          State: { Running: false },
          Config: { Image: 'nginx:1.1.0' },
        },
        'nginx:1.0.0',
        container,
        mockLog,
      ),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
  });

  test('recreateContainer should reject a repository changed after service resolution before mutation', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const changedComposeFileContent = ['services:', '  nginx:', '    image: postgres:16', ''].join(
      '\n',
    );
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(changedComposeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const refreshComposeServiceSpy = vi
      .spyOn(trigger, 'refreshComposeServiceWithDockerApi')
      .mockResolvedValue();

    await expect(
      trigger.recreateContainer(
        mockDockerApi,
        { State: { Running: false }, Config: { Image: 'nginx:1.1.0' } },
        'nginx:1.2.0',
        container,
        mockLog,
      ),
    ).rejects.toThrow('refusing to rewrite a different repository');

    expect(writeComposeFileSpy).not.toHaveBeenCalled();
    expect(refreshComposeServiceSpy).not.toHaveBeenCalled();
  });

  test('recreateContainer should update an inherited service image while preserving override fields', async () => {
    const baseFile = '/opt/drydock/test/stack.yml';
    const overrideFile = '/opt/drydock/test/stack.override.yml';
    const container = makeContainer({
      name: 'nginx',
      labels: { 'com.docker.compose.service': 'nginx' },
    });
    vi.spyOn(trigger, 'resolveComposeServiceContext').mockResolvedValue({
      composeFile: overrideFile,
      composeFiles: [baseFile, overrideFile],
      service: 'nginx',
    });
    vi.spyOn(trigger, 'getComposeFile').mockImplementation(async (filePath) =>
      Buffer.from(
        filePath === overrideFile
          ? ['services:', '  nginx:', '    environment:', '      FOO: bar', ''].join('\n')
          : ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n'),
      ),
    );
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const refreshComposeServiceSpy = vi
      .spyOn(trigger, 'refreshComposeServiceWithDockerApi')
      .mockResolvedValue();

    await trigger.recreateContainer(
      mockDockerApi,
      { State: { Running: false }, Config: { Image: 'nginx:1.1.0' } },
      'nginx:1.2.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      overrideFile,
      expect.stringContaining('image: nginx:1.2.0'),
    );
    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      overrideFile,
      expect.stringContaining('FOO: bar'),
    );
    expect(refreshComposeServiceSpy).toHaveBeenCalledWith(
      overrideFile,
      'nginx',
      container,
      expect.objectContaining({ composeFiles: [baseFile, overrideFile] }),
    );
  });

  test('recreateContainer should fallback to registry-derived image when current spec image is missing', async () => {
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const resolveContextSpy = vi.spyOn(trigger, 'resolveComposeServiceContext');
    vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: {},
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(resolveContextSpy).toHaveBeenCalledWith(container, 'nginx:1.0.0');
  });

  test('recreateContainer integration should update compose image and recreate via Docker API without pull', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    const verifyCompatibilitySpy = vi.spyOn(trigger, 'verifyPulledImageCompatibility');

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.0.0'),
    );
    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).toHaveBeenCalledTimes(1);
    // The container this recreates has an update candidate of 1.1.0, so
    // anything that re-derives its own target lands on the update instead of
    // the 1.0.0 the caller asked for and the compose file now carries.
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:1.0.0' }),
      'nginx',
      expect.anything(),
    );
    expect(verifyCompatibilitySpy).toHaveBeenCalledWith(
      mockDockerApi,
      'nginx:1.0.0',
      expect.anything(),
      // skipPull, so the compatibility pre-flight is also the missing-image
      // guard that keeps the running container out of harm's way (DR-110).
      { requireLocalImage: true },
    );
  });

  test('recreateContainer refuses before removing the running container when the image is absent locally', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const pullImageSpy = vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    const stopContainerSpy = vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    const removeContainerSpy = vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);
    // Security is off in this suite, so the identity binding policy is
    // `disabled`: capturePulledImageIdentity swallows the failed inspect
    // instead of throwing, which is what used to carry an absent image all the
    // way past the stop/remove and into a failing create (DR-110).
    mockDockerApi.getImage = vi.fn().mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('(HTTP code 404) no such image')),
    });

    await expect(
      trigger.recreateContainer(
        mockDockerApi,
        {
          State: { Running: true },
          Config: { Image: 'nginx:1.1.0' },
        },
        'nginx:1.0.0',
        container,
        mockLog,
      ),
    ).rejects.toThrow(/Cannot recreate from nginx:1\.0\.0: the image is not available locally/);

    expect(pullImageSpy).not.toHaveBeenCalled();
    expect(stopContainerSpy).not.toHaveBeenCalled();
    expect(removeContainerSpy).not.toHaveBeenCalled();
    expect(createContainerSpy).not.toHaveBeenCalled();
    // The compose file goes back to what it said before, so the failed
    // rollback leaves neither the runtime nor the file half-moved.
    expect(writeComposeFileSpy).toHaveBeenLastCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('image: nginx:1.1.0'),
    );
  });

  test('recreateContainer integration should recreate from the requested image after a resync moved the tag to the candidate', async () => {
    trigger.configuration.dryrun = false;
    // What the store holds once maybeFastResyncAfterUpdate has run: the tag
    // value is already the candidate and there is no scan result left to read,
    // so the container itself no longer says anything about 1.0.0.
    const container = makeContainer({
      name: 'nginx',
      tagValue: '1.1.0',
      remoteValue: null,
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(writeComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.0.0'),
    );
    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:1.0.0' }),
      'nginx',
      expect.anything(),
    );
  });

  test('recreateContainer integration should leave a republished index unbound instead of pinning the update candidate digest', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
      // The manifest the watcher resolved for the update this recreate undoes.
      result: { digest: 'sha256:bbbb' },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    // One local image ID carrying both the retained manifest and the
    // republished one, which is the tie capturePulledImageIdentity has to break.
    mockDockerApi.getImage = vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:localimage',
        RepoDigests: ['nginx@sha256:aaaa', 'nginx@sha256:bbbb'],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0',
      container,
      mockLog,
    );

    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:1.0.0' }),
      'nginx',
      expect.anything(),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('none of them is the manifest this pull was pinned to'),
    );
  });

  test('recreateContainer integration should break a digest tie with the digest the requested image pins', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
      result: { digest: 'sha256:bbbb' },
    });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    mockDockerApi.getImage = vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'sha256:localimage',
        RepoDigests: ['nginx@sha256:aaaa', 'nginx@sha256:bbbb'],
        Architecture: process.arch === 'x64' ? 'amd64' : process.arch,
        Os: 'linux',
      }),
    });
    const createContainerSpy = vi.spyOn(trigger, 'createContainer').mockResolvedValue({
      inspect: vi.fn().mockResolvedValue({ Image: 'sha256:localimage' }),
      start: vi.fn().mockResolvedValue(undefined),
    } as any);

    await trigger.recreateContainer(
      mockDockerApi,
      {
        State: { Running: true },
        Config: { Image: 'nginx:1.1.0' },
      },
      'nginx:1.0.0@sha256:aaaa',
      container,
      mockLog,
    );

    expect(createContainerSpy).toHaveBeenCalledWith(
      mockDockerApi,
      expect.objectContaining({ Image: 'nginx:1.0.0@sha256:aaaa' }),
      'nginx',
      expect.anything(),
    );
  });

  test('recreateContainer should restore original compose text when runtime refresh fails and rollback succeeds', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    # existing comment',
      '    image: nginx:1.1.0 # old image',
      '',
    ].join('\n');
    const failedCandidate = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const restoredContainer = {
      start: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    const createContainerSpy = vi
      .spyOn(trigger, 'createContainer')
      .mockResolvedValueOnce(failedCandidate as any)
      .mockResolvedValueOnce(restoredContainer as any);
    vi.spyOn(trigger, 'startContainer')
      .mockRejectedValueOnce(new Error('runtime refresh failed'))
      .mockResolvedValueOnce(undefined);

    let thrownError: any;
    try {
      await trigger.recreateContainer(
        mockDockerApi,
        {
          State: { Running: true },
          Config: { Image: 'nginx:1.1.0' },
        },
        'nginx:1.0.0',
        container,
        mockLog,
      );
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('runtime refresh failed');
    expect(thrownError.composeRollbackOutcome).toEqual({
      status: 'rolled-back',
      phase: 'rolled-back',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: 'runtime refresh failed',
    });
    expect(createContainerSpy).toHaveBeenCalledTimes(2);
    expect(writeComposeFileSpy.mock.calls).toEqual([
      ['/opt/drydock/test/stack.yml', expect.stringContaining('nginx:1.0.0')],
      ['/opt/drydock/test/stack.yml', composeFileContent],
    ]);
  });

  test('recreateContainer should report rollback-failed when compose text restore fails', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'nginx',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'nginx',
      },
    });
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    # existing comment',
      '    image: nginx:1.1.0 # old image',
      '',
    ].join('\n');
    const failedCandidate = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const restoredContainer = {
      start: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
    );
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    vi.spyOn(trigger, 'createContainer')
      .mockResolvedValueOnce(failedCandidate as any)
      .mockResolvedValueOnce(restoredContainer as any);
    vi.spyOn(trigger, 'startContainer')
      .mockRejectedValueOnce(new Error('runtime refresh failed'))
      .mockResolvedValueOnce(undefined);

    let thrownError: any;
    try {
      await trigger.recreateContainer(
        mockDockerApi,
        {
          State: { Running: true },
          Config: { Image: 'nginx:1.1.0' },
        },
        'nginx:1.0.0',
        container,
        mockLog,
      );
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('runtime refresh failed');
    expect(thrownError.composeRollbackOutcome).toEqual({
      status: 'rollback-failed',
      phase: 'rollback-failed',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: 'runtime refresh failed',
    });
  });

  test('processComposeFile should restore the original compose image when runtime refresh fails', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx', updateAvailable: true });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const compose = makeCompose({ nginx: { image: 'nginx:1.0.0' } });

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(compose);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockRejectedValue(
      new Error('runtime refresh failed'),
    );

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('runtime refresh failed');

    expect(writeComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(writeComposeFileSpy.mock.calls[0]).toEqual([
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('nginx:1.1.0'),
    ]);
    expect(writeComposeFileSpy.mock.calls[1]).toEqual([
      '/opt/drydock/test/stack.yml',
      composeFileContent,
    ]);
  });

  test('processComposeFile should surface a failed compose restore on the runtime error', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx', updateAvailable: true });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockRejectedValue(
      new Error('runtime refresh failed'),
    );

    const thrownError = await trigger
      .processComposeFile('/opt/drydock/test/stack.yml', [container])
      .catch((error) => error);

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe(
      'runtime refresh failed (compose file restore failed: Failed to restore compose file mutations ' +
        '(/opt/drydock/test/stack.yml: compose restore write failed))',
    );
  });

  test('processComposeFile should surface a failed compose restore on a non-Error runtime failure', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx', updateAvailable: true });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockRejectedValue('runtime refresh exploded');

    const thrownError = await trigger
      .processComposeFile('/opt/drydock/test/stack.yml', [container])
      .catch((error) => error);

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toContain('runtime refresh exploded');
    expect(thrownError.message).toContain('compose restore write failed');
  });

  test('processComposeFile should keep the rollback outcome of a non-Error runtime failure', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx', updateAvailable: true });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const composeRollbackOutcome = {
      status: 'rolled-back',
      phase: 'rolled-back',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: 'runtime refresh failed',
    };

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    const runtimeFailure = { message: 'runtime refresh failed', composeRollbackOutcome };
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockRejectedValue(runtimeFailure);

    const thrownError = await trigger
      .processComposeFile('/opt/drydock/test/stack.yml', [container])
      .catch((error) => error);

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe(
      'runtime refresh failed (compose file restore failed: Failed to restore compose file mutations ' +
        '(/opt/drydock/test/stack.yml: compose restore write failed))',
    );
    expect(thrownError.composeRollbackOutcome).toEqual(composeRollbackOutcome);
    expect(thrownError.cause).toBe(runtimeFailure);
  });

  test('processComposeFile should surface a failed partial compose restore instead of claiming it restored', async () => {
    trigger.configuration.dryrun = false;
    const containers = [
      makeContainer({ name: 'nginx', updateAvailable: true }),
      makeContainer({
        name: 'redis',
        imageName: 'redis',
        tagValue: '7.0.0',
        remoteValue: '7.2.0',
        updateAvailable: true,
      }),
    ];
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({
        nginx: { image: 'nginx:1.0.0' },
        redis: { image: 'redis:7.0.0' },
      }),
    );
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    vi.spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('redis runtime refresh failed'));

    const thrownError = await trigger
      .processComposeFile('/opt/drydock/test/stack.yml', containers)
      .catch((error) => error);

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toContain('redis runtime refresh failed');
    expect(thrownError.message).toContain('compose restore write failed');
    expect(trigger.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Restored compose file mutations'),
    );
  });

  test('processComposeFile should not restore the whole compose file after an earlier service succeeds', async () => {
    trigger.configuration.dryrun = false;
    const containers = [
      makeContainer({ name: 'nginx', updateAvailable: true }),
      makeContainer({
        name: 'redis',
        imageName: 'redis',
        tagValue: '7.0.0',
        remoteValue: '7.2.0',
        updateAvailable: true,
      }),
    ];
    const composeFileContent = [
      'services:',
      '  nginx:',
      '    image: nginx:1.0.0',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');
    const compose = makeCompose({
      nginx: { image: 'nginx:1.0.0' },
      redis: { image: 'redis:7.0.0' },
    });

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(compose);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'runContainerUpdateLifecycle')
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('redis runtime refresh failed'));

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', containers),
    ).rejects.toThrow('redis runtime refresh failed');

    expect(writeComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(writeComposeFileSpy.mock.calls[0]).toEqual([
      '/opt/drydock/test/stack.yml',
      expect.stringContaining('redis:7.2.0'),
    ]);
    const partiallyRestoredComposeText = writeComposeFileSpy.mock.calls[1][1] as string;
    expect(partiallyRestoredComposeText).toContain('nginx:1.1.0');
    expect(partiallyRestoredComposeText).toContain('redis:7.0.0');
    expect(partiallyRestoredComposeText).not.toContain('redis:7.2.0');
    expect(trigger.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('preserving completed services (nginx)'),
    );
  });

  test('processComposeFile should preserve a service refreshed before post-start hook failure', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({ name: 'nginx', updateAvailable: true });
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const compose = makeCompose({ nginx: { image: 'nginx:1.0.0' } });

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(compose);
    const writeComposeFileSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    vi.spyOn(trigger, 'runContainerUpdateLifecycle').mockImplementation(
      async (_container, composeContext) => {
        expect(typeof composeContext.onRuntimeUpdateApplied).toBe('function');
        composeContext.onRuntimeUpdateApplied();
        throw new Error('post-start hook failed');
      },
    );

    await expect(
      trigger.processComposeFile('/opt/drydock/test/stack.yml', [container]),
    ).rejects.toThrow('post-start hook failed');

    const finalComposeText = writeComposeFileSpy.mock.calls.at(-1)?.[1] as string;
    expect(finalComposeText).toContain('nginx:1.1.0');
    expect(finalComposeText).not.toBe(composeFileContent);
  });

  test('executeSelfUpdate should delegate to parent self-update transition with hydrated runtime context', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle();
    const currentContainerSpec = {
      Id: 'current-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(currentContainer);
    const inspectContainerSpy = vi
      .spyOn(trigger, 'inspectContainer')
      .mockResolvedValue(currentContainerSpec as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer: null,
        currentContainerSpec: null,
      },
      container,
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).toHaveBeenCalledWith(mockDockerApi, container);
    expect(inspectContainerSpy).toHaveBeenCalledWith(currentContainer, mockLog);
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      undefined,
    );
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
  });

  test('executeSelfUpdate should reuse current container and inspection from context when available', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle({ id: 'context-container-id' });
    const currentContainerSpec = {
      Id: 'context-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle({ id: 'fetched-id' }));
    const inspectContainerSpy = vi.spyOn(trigger, 'inspectContainer').mockResolvedValue({
      Id: 'fetched-id',
      State: { Running: true },
    } as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer,
        currentContainerSpec,
      },
      container,
      mockLog,
      'op-self-update-context',
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(inspectContainerSpy).not.toHaveBeenCalled();
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      'op-self-update-context',
    );
  });

  test('executeSelfUpdate should inspect context current container when inspection is missing', async () => {
    trigger.configuration.dryrun = false;
    const container = makeContainer({
      name: 'drydock',
      imageName: 'codeswhat/drydock',
      labels: {
        'dd.compose.file': '/opt/drydock/test/stack.yml',
        'com.docker.compose.service': 'drydock',
      },
    });
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const currentContainer = makeDockerContainerHandle({ id: 'context-container-id' });
    const currentContainerSpec = {
      Id: 'context-inspected-id',
      Name: '/drydock',
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };

    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle({ id: 'fetched-id' }));
    const inspectContainerSpy = vi
      .spyOn(trigger, 'inspectContainer')
      .mockResolvedValue(currentContainerSpec as any);
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer,
        currentContainerSpec: null,
      },
      container,
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(true);
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(inspectContainerSpy).toHaveBeenCalledWith(currentContainer, mockLog);
    expect(orchestratorExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentContainer,
        currentContainerSpec,
      }),
      container,
      mockLog,
      undefined,
    );
  });

  test('performContainerUpdate should throw when compose context is missing', async () => {
    await expect(
      trigger.performContainerUpdate(
        {},
        {
          name: 'missing-container',
        },
      ),
    ).rejects.toThrow('Missing compose context for container missing-container');
  });

  test('executeSelfUpdate should throw when compose context is missing', async () => {
    await expect(
      trigger.executeSelfUpdate(
        {
          dockerApi: mockDockerApi,
          registry: getState().registry.hub,
          auth: {},
          newImage: 'codeswhat/drydock:1.1.0',
          currentContainer: null,
          currentContainerSpec: null,
        },
        {
          name: 'drydock',
        },
        mockLog,
      ),
    ).rejects.toThrow('Missing compose context for self-update container drydock');
  });

  test('executeSelfUpdate should skip work in dry-run mode', async () => {
    trigger.configuration.dryrun = true;
    const composeContext = {
      composeFile: '/opt/drydock/test/stack.yml',
      service: 'drydock',
      serviceDefinition: {},
    };
    const composeUpdateSpy = vi.spyOn(trigger, 'updateContainerWithCompose').mockResolvedValue();
    const hooksSpy = vi.spyOn(trigger, 'runServicePostStartHooks').mockResolvedValue();
    const getCurrentContainerSpy = vi
      .spyOn(trigger, 'getCurrentContainer')
      .mockResolvedValue(makeDockerContainerHandle());
    const orchestratorExecuteSpy = vi
      .spyOn(trigger.selfUpdateOrchestrator, 'execute')
      .mockResolvedValue(true);

    const updated = await trigger.executeSelfUpdate(
      {
        dockerApi: mockDockerApi,
        registry: getState().registry.hub,
        auth: {},
        newImage: 'codeswhat/drydock:1.1.0',
        currentContainer: null,
        currentContainerSpec: null,
      },
      {
        name: 'drydock',
      },
      mockLog,
      undefined,
      composeContext,
    );

    expect(updated).toBe(false);
    expect(composeUpdateSpy).not.toHaveBeenCalled();
    expect(hooksSpy).not.toHaveBeenCalled();
    expect(getCurrentContainerSpy).not.toHaveBeenCalled();
    expect(orchestratorExecuteSpy).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Do not replace the existing container because dry-run mode is enabled',
    );
  });

  test('resolveComposeFilePath should allow absolute compose files while blocking relative traversal when boundary is enforced', () => {
    const composeFilePathOutsideWorkingDirectory = path.resolve(
      process.cwd(),
      '..',
      'outside',
      'stack.yml',
    );

    expect(trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory)).toBe(
      composeFilePathOutsideWorkingDirectory,
    );
    expect(
      trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory, {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).toBe(composeFilePathOutsideWorkingDirectory);
    expect(() =>
      trigger.resolveComposeFilePath('../outside/stack.yml', {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).toThrow(/Compose file path must stay inside/);
    expect(() =>
      trigger.resolveComposeFilePath(composeFilePathOutsideWorkingDirectory, {
        enforceWorkingDirectoryBoundary: true,
      }),
    ).not.toThrow();
  });

  test('resolveComposeFilePathFromDirectory should return original path when target is a file', async () => {
    fs.stat.mockResolvedValueOnce({
      isDirectory: () => false,
      mtimeMs: 1_700_000_000_000,
    } as any);

    const resolved = await trigger.resolveComposeFilePathFromDirectory(
      '/opt/drydock/test/stack.yml',
    );

    expect(resolved).toBe('/opt/drydock/test/stack.yml');
  });

  test('resolveComposeFilePathFromDirectory should warn and return null when directory has no compose candidates', async () => {
    fs.stat.mockResolvedValueOnce({
      isDirectory: () => true,
      mtimeMs: 1_700_000_000_000,
    } as any);
    const missingComposeFileError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fs.access
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError)
      .mockRejectedValueOnce(missingComposeFileError);

    const resolved = await trigger.resolveComposeFilePathFromDirectory('/opt/drydock/test/stack');

    expect(resolved).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not contain a compose file candidate'),
    );
  });

  test('resolveComposeServiceContext should throw when no compose file is configured', async () => {
    trigger.configuration.file = undefined;

    await expect(
      trigger.resolveComposeServiceContext(
        {
          name: 'nginx',
          watcher: 'local',
        },
        'nginx:1.0.0',
      ),
    ).rejects.toThrow('No compose file configured for nginx');
  });

  test('resolveComposeServiceContext should throw when service cannot be resolved from compose file', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ redis: { image: 'redis:7.0.0' } }),
    );

    await expect(
      trigger.resolveComposeServiceContext(
        {
          name: 'nginx',
          watcher: 'local',
          labels: {
            'dd.compose.file': '/opt/drydock/test/stack.yml',
          },
          image: {
            name: 'nginx',
            registry: { name: 'hub' },
            tag: { value: '1.0.0' },
          },
        },
        'nginx:1.0.0',
      ),
    ).rejects.toThrow(
      'Unable to resolve compose service for nginx from /opt/drydock/test/stack.yml',
    );
  });

  test('resolveComposeServiceContext should return compose file chain and deterministic writable file', async () => {
    vi.spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValueOnce(makeCompose({ nginx: { image: 'nginx:1.0.0' } }))
      .mockResolvedValueOnce(makeCompose({ nginx: { image: 'nginx:1.1.0' } }));

    const context = await trigger.resolveComposeServiceContext(
      {
        name: 'nginx',
        watcher: 'local',
        labels: {
          'com.docker.compose.project.config_files':
            '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
          'com.docker.compose.service': 'nginx',
        },
        image: {
          name: 'nginx',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
        },
      },
      'nginx:1.0.0',
    );

    expect(context.composeFiles).toEqual([
      '/opt/drydock/test/stack.yml',
      '/opt/drydock/test/stack.override.yml',
    ]);
    expect(context.composeFile).toBe('/opt/drydock/test/stack.override.yml');
  });

  // -----------------------------------------------------------------------
  // runServicePostStartHooks
  // -----------------------------------------------------------------------

  test('runServicePostStartHooks should execute configured hooks on recreated container', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [
        {
          command: 'echo hello',
          user: 'root',
          working_dir: '/tmp',
          privileged: true,
          environment: { TEST: '1' },
        },
      ],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
        User: 'root',
        WorkingDir: '/tmp',
        Privileged: true,
        Env: ['TEST=1'],
      }),
    );
    expect(mockExec.inspect).toHaveBeenCalledTimes(1);
  });

  test('runServicePostStartHooks should support string hook syntax', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
      }),
    );
  });

  test('runServicePostStartHooks should skip when dryrun is true', async () => {
    trigger.configuration.dryrun = true;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should skip when service has no post_start', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {});

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should warn when watcher dockerApi is unavailable', async () => {
    trigger.configuration.dryrun = false;

    await trigger.runServicePostStartHooks(
      {
        name: 'ghost',
        watcher: 'missing',
      },
      'ghost',
      { post_start: ['echo hello'] },
    );

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Skip compose post_start hooks for ghost (ghost) because watcher Docker API is unavailable',
    );
  });

  test('runServicePostStartHooks should skip when container is not running', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const recreatedContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: false },
      }),
    };
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  test('runServicePostStartHooks should skip hook with no command', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const recreatedContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true },
      }),
      exec: vi.fn(),
    };
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ user: 'root' }],
    });

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('command is missing'));
    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should throw on non-zero exit code', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks({ exitCode: 1, streamEvent: 'end' });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: ['failing-command'],
      }),
    ).rejects.toThrow('exit code 1');
  });

  test('runServicePostStartHooks should handle exec stream error', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks({
      streamError: new Error('stream failure'),
    });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: ['echo hello'],
      }),
    ).rejects.toThrow('stream failure');
  });

  test('runServicePostStartHooks should handle stream without resume', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks({ hasResume: false });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockExec.inspect).toHaveBeenCalled();
  });

  test('runServicePostStartHooks should handle stream without once', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer, mockExec } = makeExecMocks({ hasOnce: false });
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: ['echo hello'],
    });

    expect(mockExec.inspect).toHaveBeenCalled();
  });

  test('runServicePostStartHooks should support array command form', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: ['echo', 'hello'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['echo', 'hello'],
      }),
    );
  });

  test('runServicePostStartHooks should support environment as array', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: ['FOO=bar', 'BAZ=1'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['FOO=bar', 'BAZ=1'],
      }),
    );
  });

  test('runServicePostStartHooks should support environment array entries without equals sign', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: ['FOO', 'BAR=1'] }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['FOO', 'BAR=1'],
      }),
    );
  });

  test('runServicePostStartHooks should reject object environment with invalid key', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: [{ command: 'echo hello', environment: { 'INVALID-KEY': '1' } }],
      }),
    ).rejects.toThrow('Invalid compose post_start environment variable key "INVALID-KEY"');

    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should reject array environment with invalid key', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await expect(
      trigger.runServicePostStartHooks(container, 'netbox', {
        post_start: [{ command: 'echo hello', environment: ['INVALID-KEY=1'] }],
      }),
    ).rejects.toThrow('Invalid compose post_start environment variable key "INVALID-KEY"');

    expect(recreatedContainer.exec).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should normalize single post_start hook (not array)', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: { command: 'echo hello' },
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'echo hello'],
      }),
    );
  });

  test('runServicePostStartHooks should return early when normalized hooks array is empty', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [],
    });

    expect(mockDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('runServicePostStartHooks should handle environment with null values', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: { KEY: null } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['KEY='],
      }),
    );
  });

  test('runServicePostStartHooks should JSON-stringify object environment values', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'netbox', watcher: 'local' };
    const { recreatedContainer } = makeExecMocks();
    mockDockerApi.getContainer.mockReturnValue(recreatedContainer);

    await trigger.runServicePostStartHooks(container, 'netbox', {
      post_start: [{ command: 'echo hello', environment: { KEY: { nested: 'value' } } }],
    });

    expect(recreatedContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['KEY={"nested":"value"}'],
      }),
    );
  });

  // -----------------------------------------------------------------------
});
