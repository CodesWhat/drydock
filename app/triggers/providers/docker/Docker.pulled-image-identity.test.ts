import {
  configurationValid,
  createMockLog,
  createSecurityConfiguration,
  createSecurityScanResult,
  createSignatureVerificationResult,
  createTriggerContainer,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
  stubTriggerFlow,
} from './Docker.test.helpers.js';

registerCommonDockerBeforeEach();
const {
  mockGetSecurityConfiguration,
  mockGetState,
  mockMarkOperationTerminal,
  mockScanImageForVulnerabilities,
  mockSyncComposeFileTag,
  mockVerifyImageSignature,
} = getDockerTestMocks();

const SIGNATURE_VERIFY_CONFIGURATION = {
  signature: {
    verify: true,
    cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
  },
};

const PULLED_DIGEST = `sha256:${'a'.repeat(64)}`;
const RETAGGED_DIGEST = `sha256:${'b'.repeat(64)}`;
const LOCAL_IMAGE_ID = `sha256:${'c'.repeat(64)}`;

function createImageApi(inspectResult) {
  return {
    getImage: vi.fn(() => ({
      inspect: vi.fn().mockResolvedValue(inspectResult),
    })),
  };
}

function createLogContainer() {
  return createMockLog('info', 'warn', 'debug');
}

test('binds a private-registry pull to the digest published under that exact repository', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [
      // Same path under a different registry — must not match.
      `docker.io/acme/web@${RETAGGED_DIGEST}`,
      `registry.example:5000/acme/web@${PULLED_DIGEST}`,
    ],
  });
  const logContainer = createLogContainer();

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'registry.example:5000/acme/web:2.0.0',
      createTriggerContainer(),
      logContainer,
    ),
  ).resolves.toEqual({
    imageIdentity: `registry.example:5000/acme/web:2.0.0@${PULLED_DIGEST}`,
  });
  expect(logContainer.info).toHaveBeenCalledWith(
    `Pinned pulled image registry.example:5000/acme/web:2.0.0 (local ${LOCAL_IMAGE_ID}) to registry.example:5000/acme/web:2.0.0@${PULLED_DIGEST}`,
  );
});

test('keeps the operator tag when rebinding a Docker Hub short reference', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [`nginx@${PULLED_DIGEST}`],
  });

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'nginx:1.1.0',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
});

test('leaves a digest-only reference alone because it is already immutable', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [`nginx@${PULLED_DIGEST}`],
  });
  const logContainer = createLogContainer();

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      `nginx@${PULLED_DIGEST}`,
      createTriggerContainer(),
      logContainer,
    ),
  ).resolves.toEqual({ imageIdentity: `nginx@${PULLED_DIGEST}` });
  expect(logContainer.info).not.toHaveBeenCalled();
});

test('pins the image even when the security gate is switched off', async () => {
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [`nginx@${PULLED_DIGEST}`],
  });

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'nginx:1.1.0',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
});

test('proceeds without an identity when the gate is off and nothing can be bound', async () => {
  const logContainer = createLogContainer();

  await expect(
    docker.bindPulledImageIdentity({}, 'nginx:1.1.0', createTriggerContainer(), logContainer),
  ).resolves.toEqual({});
});

test('fails closed when signature verification needs an identity it cannot bind', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
      },
    }),
  );

  await expect(
    docker.bindPulledImageIdentity(
      {},
      'nginx:1.1.0',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).rejects.toThrow(
    'Unable to bind security gate to the pulled image for container-name: Docker image inspection is unavailable',
  );
});

test('fails closed in block mode when the daemon reports no matching manifest digest', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({ availabilityPolicy: 'block' }),
  );
  const dockerApi = createImageApi({ Id: LOCAL_IMAGE_ID, RepoDigests: [] });

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'nginx:1.1.0',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).rejects.toThrow(
    'Unable to bind security gate to the pulled image for container-name: Docker image inspection returned no local ID and matching manifest digest',
  );
});

test('audits a skipped scan and continues under availability policy warn', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({ availabilityPolicy: 'warn' }),
  );
  const logWarn = vi.spyOn(docker.log, 'warn').mockImplementation(() => {});
  const recordSecurityAudit = vi.spyOn(docker, 'recordSecurityAudit').mockImplementation(() => {});
  const container = createTriggerContainer();
  const dockerApi = createImageApi({ Id: LOCAL_IMAGE_ID, RepoDigests: ['nginx@not-a-digest'] });

  await expect(
    docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, createLogContainer()),
  ).resolves.toEqual({ skipSecurityGate: true });

  expect(logWarn).toHaveBeenCalledWith(
    expect.stringContaining('proceeding without an immutable image reference'),
  );
  expect(recordSecurityAudit).toHaveBeenCalledWith(
    'security-scan-skipped',
    container,
    'error',
    expect.stringContaining('DD_SECURITY_AVAILABILITY_POLICY=warn'),
  );
});

test('createTriggerContext defers signature verification to the post-pull gate', async () => {
  vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({ inspect: vi.fn() });
  vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
    Name: '/container-name',
    Id: '123',
    State: { Running: false },
    Config: {},
    HostConfig: {},
  });

  const context = await docker.createTriggerContext(createTriggerContainer(), createLogContainer());

  expect(context.newImage).toBe('my-registry/test/test:4.5.6');
  expect(context.deferSignatureVerification).toBe(true);
});

test('a registry retag after the pull cannot change what gets scanned or deployed', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());

  // One stable registry state so the watcher's dockerApi survives every lookup.
  const registryState = mockGetState();
  mockGetState.mockReturnValue(registryState);

  const inspectedReferences: string[] = [];
  let mutableTagLookups = 0;
  registryState.watcher['docker.test'].dockerApi.getImage = vi.fn((image: string) => ({
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockImplementation(async () => {
      inspectedReferences.push(image);
      const pinnedDigest = image.includes('@sha256:') ? image.split('@')[1] : undefined;
      // The registry repoints `:4.5.6` immediately after the pull is inspected,
      // so any later resolution of the mutable tag yields a different image.
      const digest = pinnedDigest ?? (mutableTagLookups++ === 0 ? PULLED_DIGEST : RETAGGED_DIGEST);
      return {
        Id: LOCAL_IMAGE_ID,
        RepoDigests: [`my-registry/test/test@${digest}`],
      };
    }),
  }));
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  const pinnedImage = `my-registry/test/test:4.5.6@${PULLED_DIGEST}`;
  expect(inspectedReferences[0]).toBe('my-registry/test/test:4.5.6');
  expect(inspectedReferences.slice(1)).not.toContain('my-registry/test/test:4.5.6');
  expect(mockScanImageForVulnerabilities).toHaveBeenCalledWith(
    expect.objectContaining({ image: pinnedImage }),
  );
  expect(docker.cloneContainer).toHaveBeenCalledWith(
    expect.anything(),
    pinnedImage,
    expect.anything(),
  );
  // The operator-facing reference is unchanged: the compose file keeps the tag.
  expect(mockSyncComposeFileTag).toHaveBeenCalledWith(
    expect.objectContaining({ newImage: 'my-registry/test/test:4.5.6' }),
  );
});

function stubWatcherImageInspect(inspectResult) {
  const registryState = mockGetState();
  mockGetState.mockReturnValue(registryState);
  registryState.watcher['docker.test'].dockerApi.getImage = vi.fn(() => ({
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue(inspectResult),
  }));
  return registryState;
}

test('runs the pre-update hook and prune/backup only after the pinned image clears the gate', async () => {
  docker.configuration = { ...configurationValid, prune: true };
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration(SIGNATURE_VERIFY_CONFIGURATION),
  );
  const calls: string[] = [];
  mockVerifyImageSignature.mockImplementation(async () => {
    calls.push('verify-signature');
    return createSignatureVerificationResult();
  });
  mockScanImageForVulnerabilities.mockImplementation(async () => {
    calls.push('scan');
    return createSecurityScanResult();
  });
  stubTriggerFlow({ running: true });
  vi.spyOn(docker, 'runPreUpdateHook').mockImplementation(async () => {
    calls.push('pre-update-hook');
  });
  vi.spyOn(docker, 'pruneImages').mockImplementation(async () => {
    calls.push('prune');
  });
  vi.spyOn(docker, 'insertContainerImageBackup').mockImplementation(() => {
    calls.push('backup');
  });
  vi.spyOn(docker, 'cloneContainer').mockImplementation(() => {
    calls.push('create');
    return { name: 'container-name' };
  });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(calls).toEqual([
    'verify-signature',
    'scan',
    'pre-update-hook',
    'prune',
    'backup',
    'create',
  ]);
});

test('a blocked signature stops before the pre-update hook, prune and backup', async () => {
  docker.configuration = { ...configurationValid, prune: true };
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration(SIGNATURE_VERIFY_CONFIGURATION),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({
      status: 'unverified',
      signatures: 0,
      error: 'no matching signatures',
    }),
  );
  const { pruneImagesSpy } = stubTriggerFlow({ running: true });
  const runPreUpdateHookSpy = vi.spyOn(docker, 'runPreUpdateHook');
  const insertBackupSpy = vi.spyOn(docker, 'insertContainerImageBackup');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrow(
    'Image signature verification failed',
  );

  expect(runPreUpdateHookSpy).not.toHaveBeenCalled();
  expect(pruneImagesSpy).not.toHaveBeenCalled();
  expect(insertBackupSpy).not.toHaveBeenCalled();
  expect(docker.cloneContainer).not.toHaveBeenCalled();
});

test('a required binding failure stops before the pre-update hook, prune and backup', async () => {
  docker.configuration = { ...configurationValid, prune: true };
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({ availabilityPolicy: 'block' }),
  );
  stubWatcherImageInspect({ RepoDigests: [] });
  const { pruneImagesSpy } = stubTriggerFlow({ running: true });
  const runPreUpdateHookSpy = vi.spyOn(docker, 'runPreUpdateHook');
  const insertBackupSpy = vi.spyOn(docker, 'insertContainerImageBackup');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrow(
    'Unable to bind security gate to the pulled image for container-name',
  );

  expect(runPreUpdateHookSpy).not.toHaveBeenCalled();
  expect(pruneImagesSpy).not.toHaveBeenCalled();
  expect(insertBackupSpy).not.toHaveBeenCalled();
  expect(docker.cloneContainer).not.toHaveBeenCalled();
  expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ status: 'failed', phase: 'failed' }),
  );
});

test('an availability-warn skip still runs the pre-update hook and prune/backup', async () => {
  docker.configuration = { ...configurationValid, prune: true };
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({ availabilityPolicy: 'warn' }),
  );
  vi.spyOn(docker.log, 'warn').mockImplementation(() => {});
  stubWatcherImageInspect({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: ['my-registry/test/test@not-a-digest'],
  });
  const { pruneImagesSpy } = stubTriggerFlow({ running: true });
  const runPreUpdateHookSpy = vi.spyOn(docker, 'runPreUpdateHook').mockResolvedValue(undefined);
  const insertBackupSpy = vi.spyOn(docker, 'insertContainerImageBackup');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockScanImageForVulnerabilities).not.toHaveBeenCalled();
  expect(runPreUpdateHookSpy).toHaveBeenCalled();
  expect(pruneImagesSpy).toHaveBeenCalled();
  expect(insertBackupSpy).toHaveBeenCalled();
  expect(docker.cloneContainer).toHaveBeenCalledWith(
    expect.anything(),
    'my-registry/test/test:4.5.6',
    expect.anything(),
  );
});
