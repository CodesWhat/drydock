import {
  RollbackDigestRequiredError,
  resolveRollbackImageReference,
} from '../../../util/backup.js';
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
const UNRELATED_DIGEST = `sha256:${'d'.repeat(64)}`;

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

test('binds an index.docker.io reference to the short repository digest the daemon records', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  // The daemon rewrites the index.docker.io alias to docker.io and records Hub
  // images under their short name, so the pulled reference and the RepoDigests
  // entry never spell the repository the same way.
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [`nginx@${PULLED_DIGEST}`],
  });

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'index.docker.io/nginx:1.27',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).resolves.toEqual({ imageIdentity: `nginx:1.27@${PULLED_DIGEST}` });
});

test('binds an index.docker.io library reference to the same short repository digest', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  const dockerApi = createImageApi({
    Id: LOCAL_IMAGE_ID,
    RepoDigests: [`nginx@${PULLED_DIGEST}`],
  });

  await expect(
    docker.bindPulledImageIdentity(
      dockerApi,
      'index.docker.io/library/nginx:1.27',
      createTriggerContainer(),
      createLogContainer(),
    ),
  ).resolves.toEqual({ imageIdentity: `nginx:1.27@${PULLED_DIGEST}` });
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

// A multi-arch index republished without touching this platform's layers
// leaves the daemon holding both the old and the new manifest digest for the
// same repository (`[repo@OLD, repo@NEW]`). Picking the wrong one pins the
// security gate, cosign verification and the scan to a manifest that was
// never gated for this update while the operation still reports success.
describe('disambiguating multiple RepoDigests for the same repository', () => {
  test('prefers the digest the watcher already resolved for the candidate', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const logContainer = createLogContainer();
    const container = createTriggerContainer({ result: { digest: PULLED_DIGEST } });

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('lets the caller name the digest that breaks the tie instead of the candidate', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi.fn();
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer({ result: { digest: PULLED_DIGEST } });

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer, {
        preferredDigest: RETAGGED_DIGEST,
      }),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${RETAGGED_DIGEST}` });
    expect(registryState.registry.hub.getImageManifestDigest).not.toHaveBeenCalled();
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  // Asking for a preference and having none is not the same as not asking:
  // the caller that pulled something the watcher's candidate does not describe
  // has to be able to take that digest out of the running (DR-64).
  test('drops the candidate digest entirely when the caller asks for a preference it does not have', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockResolvedValue({ digest: RETAGGED_DIGEST });
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer({ result: { digest: PULLED_DIGEST } });

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer, {
        preferredDigest: null,
      }),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${RETAGGED_DIGEST}` });
    expect(registryState.registry.hub.getImageManifestDigest).toHaveBeenCalled();
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  // Nothing names the pulled manifest: the reference carries no digest, the
  // caller has no preference, and the registry cannot be reached. The update
  // path picks the first candidate by sort order, but a caller that pinned
  // this pull to an image would be handed one of two manifests at random, so
  // it is handed nothing instead (DR-64).
  test('resolves to nothing rather than a deterministic pick when the caller pinned the pull', async () => {
    mockGetSecurityConfiguration.mockReturnValue(
      createSecurityConfiguration({ availabilityPolicy: 'warn' }),
    );
    vi.spyOn(docker.log, 'warn').mockImplementation(() => {});
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockRejectedValue(new Error('registry unreachable'));
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer({ result: { digest: PULLED_DIGEST } });

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer, {
        preferredDigest: null,
      }),
    ).resolves.toEqual({ skipSecurityGate: true });
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('none of them is the manifest this pull was pinned to'),
    );
  });

  test('falls back to a registry manifest lookup when the watcher result has no matching digest', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockResolvedValue({ digest: PULLED_DIGEST });
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    // No watcher-resolved digest on the update result: the candidate has to
    // be disambiguated another way.
    const container = createTriggerContainer();

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
    // The pulled repository is not under this container's registry, so the
    // lookup keeps the container's image name and takes only the pulled tag.
    expect(registryState.registry.hub.getImageManifestDigest).toHaveBeenCalledWith({
      ...container.image,
      name: 'test/test',
      tag: { ...container.image.tag, value: '1.1.0' },
    });
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  // The whole point of the lookup is to identify the manifest that was just
  // pulled. `container.image` still carries the tag the container is running,
  // so deriving the descriptor from it queries the wrong manifest on every
  // tag update, and on every rollback, where the reference is the backup's
  // older tag.
  test('resolves the fallback manifest from the pulled tag, not the tag the container runs', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [
        `my-registry/test/test@${RETAGGED_DIGEST}`,
        `my-registry/test/test@${PULLED_DIGEST}`,
      ],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockImplementation(async (image) =>
        image.tag.value === '4.5.6' ? { digest: PULLED_DIGEST } : { digest: RETAGGED_DIGEST },
      );
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    // Runs 1.0.0, pulled 4.5.6.
    const container = createTriggerContainer();

    await expect(
      docker.bindPulledImageIdentity(
        dockerApi,
        'my-registry/test/test:4.5.6',
        container,
        logContainer,
      ),
    ).resolves.toEqual({ imageIdentity: `my-registry/test/test:4.5.6@${PULLED_DIGEST}` });
    // Repository and tag come from the pulled reference; the registry URL,
    // which a Docker reference does not carry, stays on the container image.
    expect(registryState.registry.hub.getImageManifestDigest).toHaveBeenCalledWith({
      ...container.image,
      name: 'test/test',
      tag: { ...container.image.tag, value: '4.5.6' },
    });
    expect(container.image.tag.value).toBe('1.0.0');
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('keeps the same descriptor when the pull re-used the tag the container runs', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [
        `my-registry/test/test@${RETAGGED_DIGEST}`,
        `my-registry/test/test@${PULLED_DIGEST}`,
      ],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockResolvedValue({ digest: PULLED_DIGEST });
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    await expect(
      docker.bindPulledImageIdentity(
        dockerApi,
        'my-registry/test/test:1.0.0',
        container,
        logContainer,
      ),
    ).resolves.toEqual({ imageIdentity: `my-registry/test/test:1.0.0@${PULLED_DIGEST}` });
    expect(registryState.registry.hub.getImageManifestDigest).toHaveBeenCalledWith({
      ...container.image,
      name: 'test/test',
      tag: { ...container.image.tag, value: '1.0.0' },
    });
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('pins to the digest the pulled reference already names without any lookup', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi.fn();
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    // The watcher resolved the other candidate; the reference is authoritative.
    const container = createTriggerContainer({ result: { digest: RETAGGED_DIGEST } });

    await expect(
      docker.bindPulledImageIdentity(
        dockerApi,
        `nginx:1.1.0@${PULLED_DIGEST}`,
        container,
        logContainer,
      ),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
    expect(registryState.registry.hub.getImageManifestDigest).not.toHaveBeenCalled();
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('looks the pulled tag up when a digest-form reference names no local candidate', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockResolvedValue({ digest: PULLED_DIGEST });
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    await expect(
      docker.bindPulledImageIdentity(
        dockerApi,
        `nginx:1.1.0@${UNRELATED_DIGEST}`,
        container,
        logContainer,
      ),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${PULLED_DIGEST}` });
    // The tag is queried on its own: appending the reference's digest would
    // ask the registry for a manifest the reference already resolved.
    expect(registryState.registry.hub.getImageManifestDigest).toHaveBeenCalledWith({
      ...container.image,
      name: 'test/test',
      tag: { ...container.image.tag, value: '1.1.0' },
    });
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  test('skips the lookup for a digest-only reference that names no local candidate', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi.fn();
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    const [sortedFirst] = [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`].sort();

    await expect(
      docker.bindPulledImageIdentity(
        dockerApi,
        `nginx@${UNRELATED_DIGEST}`,
        container,
        logContainer,
      ),
    ).resolves.toEqual({ imageIdentity: sortedFirst });
    // There is no pulled tag to query, and the container's own tag names a
    // different manifest, so the ambiguity is reported instead of guessed at.
    expect(registryState.registry.hub.getImageManifestDigest).not.toHaveBeenCalled();
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple manifest digests match the pulled image repository'),
    );
  });

  test('picks deterministically and logs the ambiguity when neither source resolves a match', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    // Resolves, but to a manifest digest that matches neither local candidate.
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockResolvedValue({ digest: UNRELATED_DIGEST });
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer({ result: { digest: UNRELATED_DIGEST } });

    const [sortedFirst] = [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`].sort();

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${sortedFirst.split('@')[1]}` });
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple manifest digests match the pulled image repository'),
    );
  });

  test('falls through to the deterministic pick when the registry lookup itself fails', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi
      .fn()
      .mockRejectedValue(new Error('registry unreachable'));
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    const [sortedFirst] = [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`].sort();

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${sortedFirst.split('@')[1]}` });
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple manifest digests match the pulled image repository'),
    );
  });

  test('picks deterministically when the registry manager exposes no manifest lookup', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    // Default registry state's `hub` manager has no getImageManifestDigest.
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    const [sortedFirst] = [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`].sort();

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${sortedFirst.split('@')[1]}` });
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple manifest digests match the pulled image repository'),
    );
  });

  test('picks deterministically when the registry manifest lookup resolves without a digest', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`],
    });
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = vi.fn().mockResolvedValue({});
    mockGetState.mockReturnValue(registryState);
    const logContainer = createLogContainer();
    const container = createTriggerContainer();

    const [sortedFirst] = [`nginx@${RETAGGED_DIGEST}`, `nginx@${PULLED_DIGEST}`].sort();

    await expect(
      docker.bindPulledImageIdentity(dockerApi, 'nginx:1.1.0', container, logContainer),
    ).resolves.toEqual({ imageIdentity: `nginx:1.1.0@${sortedFirst.split('@')[1]}` });
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple manifest digests match the pulled image repository'),
    );
  });
});

describe('getRollbackIdentityBindingPolicy', () => {
  test('reports required when the security policy requires signature verification', () => {
    mockGetSecurityConfiguration.mockReturnValue(
      createSecurityConfiguration(SIGNATURE_VERIFY_CONFIGURATION),
    );
    const container = createTriggerContainer();

    expect(docker.getRollbackIdentityBindingPolicy(container)).toBe('required');
  });

  test('reports optional under an availability policy of warn', () => {
    mockGetSecurityConfiguration.mockReturnValue(
      createSecurityConfiguration({ availabilityPolicy: 'warn' }),
    );
    const container = createTriggerContainer();

    expect(docker.getRollbackIdentityBindingPolicy(container)).toBe('optional');
  });

  test('reports disabled when the security gate itself is disabled', () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration({ enabled: false }));
    const container = createTriggerContainer();

    expect(docker.getRollbackIdentityBindingPolicy(container)).toBe('disabled');
  });
});

// A manual rollback pulls the image its backup retained, not the update
// candidate, so the digest the watcher resolved for that candidate answers a
// question the rollback is not asking. These pin the end-to-end behaviour of
// the rollback resolver against the real binder: the backup's own tag decides,
// and a tie nothing can break comes back unbound instead of picked (DR-64).
describe('resolving the rollback reference through the identity binder', () => {
  const CANDIDATE_DIGEST = PULLED_DIGEST;
  const BACKUP_IMAGE_DIGEST = RETAGGED_DIGEST;
  const RUNNING_IMAGE_ID = `sha256:${'e'.repeat(64)}`;
  const BACKUP = { imageName: 'my-registry/test/test', imageTag: '1.0.0' };

  // Modelled on the production shape (see app/api/backup.test.ts): the
  // container runs 4.5.6, the tag the update moved it to, while the backup
  // retains 1.0.0. `image.id` is the running image, and the local inspect
  // answers with a different ID, so the same-tag guard in
  // resolveRollbackImageReference actually runs and lets the binder through
  // rather than being skipped for want of an ID to compare.
  function createRollbackContainer() {
    return createTriggerContainer({
      image: {
        id: RUNNING_IMAGE_ID,
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: '4.5.6' },
      },
      result: { digest: CANDIDATE_DIGEST },
    });
  }

  function createRetainedImageApi() {
    return createImageApi({
      Id: LOCAL_IMAGE_ID,
      RepoDigests: [
        `my-registry/test/test@${BACKUP_IMAGE_DIGEST}`,
        `my-registry/test/test@${CANDIDATE_DIGEST}`,
      ],
    });
  }

  function stubManifestLookup(getImageManifestDigest) {
    const registryState = mockGetState();
    registryState.registry.hub.getImageManifestDigest = getImageManifestDigest;
    mockGetState.mockReturnValue(registryState);
    return getImageManifestDigest;
  }

  test('pins the rollback to the backup image, not to the update candidate', async () => {
    mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
    const dockerApi = createRetainedImageApi();
    const getImageManifestDigest = stubManifestLookup(
      vi
        .fn()
        .mockImplementation(async (image) =>
          image.tag.value === '1.0.0'
            ? { digest: BACKUP_IMAGE_DIGEST }
            : { digest: CANDIDATE_DIGEST },
        ),
    );
    const logContainer = createLogContainer();
    const container = createRollbackContainer();

    const reference = await resolveRollbackImageReference(
      docker,
      dockerApi,
      container,
      BACKUP,
      logContainer,
    );

    expect(reference).toBe(`my-registry/test/test:1.0.0@${BACKUP_IMAGE_DIGEST}`);
    expect(reference).not.toContain(CANDIDATE_DIGEST);
    // The lookup asks about the backup's tag, not the 4.5.6 the container is
    // still running, which is the only reason it resolves the backup's digest.
    expect(getImageManifestDigest).toHaveBeenCalledWith({
      ...container.image,
      name: 'test/test',
      tag: { ...container.image.tag, value: '1.0.0' },
    });
    expect(logContainer.warn).not.toHaveBeenCalled();
  });

  // Registry unreachable, so nothing is left to say which of the two retained
  // manifests is the backup's. Under a `required` policy the rollback refuses
  // instead of recreating from whichever digest sorts first.
  test('refuses the rollback under a required policy when nothing can break the tie', async () => {
    mockGetSecurityConfiguration.mockReturnValue(
      createSecurityConfiguration(SIGNATURE_VERIFY_CONFIGURATION),
    );
    const dockerApi = createRetainedImageApi();
    stubManifestLookup(vi.fn().mockRejectedValue(new Error('registry unreachable')));
    const logContainer = createLogContainer();
    const container = createRollbackContainer();

    await expect(
      resolveRollbackImageReference(docker, dockerApi, container, BACKUP, logContainer),
    ).rejects.toThrow(RollbackDigestRequiredError);
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('none of them is the manifest this pull was pinned to'),
    );
  });

  // The same unbreakable tie under the permissive policy. The rollback still
  // goes ahead, but on the mutable tag and with the reason logged, never on
  // one of the two candidate digests.
  test('falls back to the mutable tag with a warning under a permissive policy', async () => {
    mockGetSecurityConfiguration.mockReturnValue(
      createSecurityConfiguration({ availabilityPolicy: 'warn' }),
    );
    const triggerLogWarn = vi.spyOn(docker.log, 'warn').mockImplementation(() => {});
    const dockerApi = createRetainedImageApi();
    stubManifestLookup(vi.fn().mockRejectedValue(new Error('registry unreachable')));
    const logContainer = createLogContainer();
    const container = createRollbackContainer();

    const reference = await resolveRollbackImageReference(
      docker,
      dockerApi,
      container,
      BACKUP,
      logContainer,
    );

    expect(reference).toBe('my-registry/test/test:1.0.0');
    expect(reference).not.toContain(CANDIDATE_DIGEST);
    expect(triggerLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('proceeding without an immutable image reference'),
    );
    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'No digest could be established for the rollback of my-registry/test/test:1.0.0',
      ),
    );
  });
});
