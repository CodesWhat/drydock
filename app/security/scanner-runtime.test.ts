import { beforeEach, vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
const mockDockerConstructor = vi.hoisted(() => vi.fn());
const mockCreateDockerScannerBackend = vi.hoisted(() => vi.fn());
const mockRecordAuditEvent = vi.hoisted(() => vi.fn());
const mockDockerClient = vi.hoisted(() => ({ modem: {} }));

vi.mock('../configuration/index.js', () => ({
  getSecurityConfiguration: (...args: unknown[]) => mockGetSecurityConfiguration(...args),
}));

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('dockerode', () => ({
  default: function MockDocker(options: unknown) {
    mockDockerConstructor(options);
    return mockDockerClient;
  },
}));

vi.mock('./backends/docker.js', () => ({
  createDockerScannerBackend: (...args: unknown[]) => mockCreateDockerScannerBackend(...args),
}));

vi.mock('../api/audit-events.js', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

import {
  clearDefaultScannerRuntime,
  createScannerRuntime,
  getDefaultScannerRuntime,
} from './scanner-runtime.js';

function createBackend() {
  return {
    run: vi.fn(async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: '' })),
    pullImage: vi.fn(async () => undefined),
    inspectImage: vi.fn(async (image: string) => ({
      image,
      digest: image.split('@')[1],
      version: '1.2.3',
    })),
  };
}

function createConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    scanner: 'both',
    backend: 'docker',
    trivy: { workerImage: `aquasec/trivy@sha256:${'a'.repeat(64)}`, timeout: 1000 },
    grype: { workerImage: `anchore/grype@sha256:${'b'.repeat(64)}`, timeout: 2000 },
    syft: { workerImage: `anchore/syft@sha256:${'c'.repeat(64)}`, timeout: 3000 },
    signature: {
      verify: false,
      cosign: {
        workerImage: `ghcr.io/sigstore/cosign/cosign@sha256:${'d'.repeat(64)}`,
        timeout: 4000,
      },
    },
    sbom: { enabled: true, generator: 'auto' },
    docker: {
      socket: '/var/run/docker.sock',
      host: '',
      port: 2375,
      protocol: 'http',
      network: 'bridge',
      cacheVolumePrefix: 'drydock-scanner',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PATH', '');
  clearDefaultScannerRuntime();
  mockGetSecurityConfiguration.mockReturnValue(createConfiguration());
  mockCreateDockerScannerBackend.mockImplementation(() => createBackend());
});

test('executes provider invocations in hardened Docker workers with bounded provider env', async () => {
  const trivy = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration(),
    backends: { trivy, grype: createBackend(), syft: createBackend() },
  });

  const output = await runtime.run({
    provider: 'trivy',
    args: ['image', '--format', 'json', 'registry/app:1'],
    env: {
      DD_SESSION_SECRET: 'must-not-leak',
      TRIVY_USERNAME: 'user',
      TRIVY_PASSWORD: 'token',
    },
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });

  expect(output).toBe('{"ok":true}');
  expect(trivy.run).toHaveBeenCalledWith({
    image: expect.stringMatching(/^aquasec\/trivy@sha256:/),
    args: ['image', '--format', 'json', 'registry/app:1'],
    env: {
      TRIVY_CACHE_DIR: '/cache',
      TMPDIR: '/scratch',
      TRIVY_USERNAME: 'user',
      TRIVY_PASSWORD: 'token',
    },
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });
});

test('forwards scanner cancellation to the Docker backend', async () => {
  const trivy = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({ scanner: 'trivy', sbom: { enabled: false } }),
    backends: { trivy },
  });
  const controller = new AbortController();

  await runtime.run({
    provider: 'trivy',
    args: ['image', '--format', 'json', 'registry/app:1'],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    signal: controller.signal,
  });

  expect(trivy.run).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
});

test('auto SBOM generation uses Syft only when Grype is the sole scanner', () => {
  const grypeOnly = createScannerRuntime({
    configuration: createConfiguration({ scanner: 'grype' }),
    backends: { grype: createBackend(), syft: createBackend() },
  });
  expect(grypeOnly.sbomGenerator).toBe('syft');
  expect(grypeOnly.assets.get('grype').provider).toBe('grype');
  expect(grypeOnly.assets.get('syft').provider).toBe('syft');

  const both = createScannerRuntime({
    configuration: createConfiguration(),
    backends: { trivy: createBackend(), grype: createBackend() },
  });
  expect(both.sbomGenerator).toBe('trivy');
});

test('asset pull and warm operations drive provider worker assets', async () => {
  const grype = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({ scanner: 'grype', sbom: { enabled: false } }),
    backends: { grype },
  });

  await runtime.assets.pull('grype');
  await runtime.assets.warm('grype');

  expect(grype.pullImage).toHaveBeenCalledTimes(2);
  expect(grype.run).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ['db', 'update'],
      env: { GRYPE_DB_CACHE_DIR: '/cache', TMPDIR: '/scratch' },
    }),
  );
  expect((await runtime.assets.status())[0]).toMatchObject({
    provider: 'grype',
    state: 'ready',
    version: '1.2.3',
  });
});

test('rejects an unknown backend', () => {
  expect(() =>
    createScannerRuntime({
      configuration: createConfiguration({ backend: 'bogus' }),
      backends: {},
    }),
  ).toThrow('Docker scanner runtime does not support backend bogus');
});

test('command backend builds worker assets only for providers without a local command', () => {
  const trivy = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      backend: 'command',
      scanner: 'both',
      trivy: {
        workerImage: `aquasec/trivy@sha256:${'a'.repeat(64)}`,
        timeout: 1000,
        command: 'trivy',
        commandExplicit: false,
      },
      grype: {
        workerImage: `anchore/grype@sha256:${'b'.repeat(64)}`,
        timeout: 2000,
        command: '/opt/grype',
        commandExplicit: true,
      },
      sbom: { enabled: false },
    }),
    backends: { trivy },
  });

  expect(runtime.assets.get('trivy').backend).toBe('docker');
  expect(() => runtime.assets.get('grype')).toThrow();
});

test('command backend with every provider local builds an empty runtime', async () => {
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      backend: 'command',
      scanner: 'grype',
      grype: {
        workerImage: `anchore/grype@sha256:${'b'.repeat(64)}`,
        timeout: 2000,
        commandExplicit: true,
      },
      sbom: { enabled: false },
    }),
    backends: {},
  });
  await expect(runtime.assets.status()).resolves.toEqual([]);
});

test('auto backend uses a worker for each provider whose command does not resolve', () => {
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      backend: 'auto',
      scanner: 'grype',
      grype: {
        workerImage: `anchore/grype@sha256:${'b'.repeat(64)}`,
        timeout: 2000,
        commandExplicit: true,
      },
      sbom: { enabled: true, generator: 'auto' },
    }),
    backends: { syft: createBackend() },
  });

  expect(runtime.sbomGenerator).toBe('syft');
  expect(runtime.assets.get('syft').backend).toBe('docker');
  expect(() => runtime.assets.get('grype')).toThrow();
});

test('remote backend labels worker assets as remote', () => {
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      backend: 'remote',
      scanner: 'trivy',
      sbom: { enabled: false },
    }),
    backends: { trivy: createBackend() },
  });
  expect(runtime.assets.get('trivy').backend).toBe('remote');
});

test('runs cosign in a worker with the registry auth and key env allowlist only', async () => {
  const cosign = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'grype',
      sbom: { enabled: false },
      signature: {
        verify: true,
        cosign: {
          workerImage: `ghcr.io/sigstore/cosign/cosign@sha256:${'d'.repeat(64)}`,
          timeout: 4000,
        },
      },
    }),
    backends: { grype: createBackend(), cosign },
  });

  await runtime.run({
    provider: 'cosign',
    args: ['verify', '--output', 'json', 'registry/app:1'],
    env: {
      DD_SESSION_SECRET: 'must-not-leak',
      COSIGN_REGISTRY_USERNAME: 'user',
      COSIGN_REGISTRY_PASSWORD: 'secret',
      COSIGN_PUBLIC_KEY: 'PEM',
      HOME: '/root',
    },
    timeoutMs: 4000,
    maxOutputBytes: 1024,
  });

  expect(cosign.run).toHaveBeenCalledWith({
    image: expect.stringMatching(/^ghcr\.io\/sigstore\/cosign\/cosign@sha256:d+$/),
    args: ['verify', '--output', 'json', 'registry/app:1'],
    env: {
      HOME: '/tmp',
      TUF_ROOT: '/tmp/tuf',
      COSIGN_REGISTRY_USERNAME: 'user',
      COSIGN_REGISTRY_PASSWORD: 'secret',
      COSIGN_PUBLIC_KEY: 'PEM',
    },
    timeoutMs: 4000,
    maxOutputBytes: 1024,
    signal: undefined,
  });
});

test('cosign worker assets pull with the configured timeout and have no warm-up command', async () => {
  const cosign = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'grype',
      sbom: { enabled: false },
      signature: {
        verify: true,
        cosign: {
          workerImage: `ghcr.io/sigstore/cosign/cosign@sha256:${'d'.repeat(64)}`,
          timeout: 4000,
        },
      },
    }),
    backends: { grype: createBackend(), cosign },
  });

  await runtime.assets.warm('cosign');
  expect(cosign.pullImage).toHaveBeenCalledWith(expect.any(String), undefined, 4000);
  expect(cosign.run).not.toHaveBeenCalled();
  expect(runtime.assets.get('cosign')).toMatchObject({ provider: 'cosign', state: 'ready' });
});

test('does not build a cosign asset unless signature verification is enabled', () => {
  const runtime = createScannerRuntime({
    configuration: createConfiguration({ scanner: 'grype', sbom: { enabled: false } }),
    backends: { grype: createBackend() },
  });
  expect(() => runtime.assets.get('cosign')).toThrow();
});

test('requires a worker backend for cosign when verification is enabled', () => {
  expect(() =>
    createScannerRuntime({
      configuration: createConfiguration({
        scanner: 'grype',
        sbom: { enabled: false },
        signature: { verify: true, cosign: { workerImage: 'x', timeout: 1 } },
      }),
      backends: { grype: createBackend() },
    }),
  ).toThrow('Docker scanner backend for cosign is not configured');
});

test('cosign command setting keeps cosign out of the worker runtime', () => {
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      backend: 'auto',
      scanner: 'grype',
      grype: {
        workerImage: `anchore/grype@sha256:${'b'.repeat(64)}`,
        timeout: 2000,
        commandExplicit: true,
      },
      sbom: { enabled: false },
      signature: {
        verify: true,
        cosign: { workerImage: 'x', timeout: 1, commandExplicit: true },
      },
    }),
    backends: {},
  });
  expect(() => runtime.assets.get('cosign')).toThrow();
});

test('honors explicit SBOM generators and requires every selected provider backend', () => {
  const syftRuntime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'trivy',
      sbom: { enabled: true, generator: 'syft' },
    }),
    backends: { trivy: createBackend(), syft: createBackend() },
  });
  expect(syftRuntime.sbomGenerator).toBe('syft');
  expect(syftRuntime.assets.get('syft').provider).toBe('syft');

  const trivyRuntime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'grype',
      sbom: { enabled: true, generator: 'trivy' },
    }),
    backends: { trivy: createBackend(), grype: createBackend() },
  });
  expect(trivyRuntime.sbomGenerator).toBe('trivy');

  expect(() =>
    createScannerRuntime({
      configuration: createConfiguration({ scanner: 'trivy', sbom: { enabled: false } }),
      backends: {},
    }),
  ).toThrow('Docker scanner backend for trivy is not configured');
});

test('handles missing worker images, inspection failures, and providers without warmup commands', async () => {
  const trivy = createBackend();
  trivy.inspectImage
    .mockRejectedValueOnce(Object.assign(new Error('missing'), { statusCode: 404 }))
    .mockRejectedValueOnce(new Error('daemon unavailable'));
  const syft = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'trivy',
      sbom: { enabled: true, generator: 'syft' },
    }),
    backends: { trivy, syft },
  });

  await expect(runtime.assets.status()).resolves.toEqual([
    expect.objectContaining({ provider: 'trivy', state: 'missing' }),
    expect.objectContaining({ provider: 'syft', state: 'ready' }),
  ]);
  await expect(runtime.assets.status()).resolves.toEqual([
    expect.objectContaining({ provider: 'trivy', state: 'error', lastError: 'daemon unavailable' }),
    expect.objectContaining({ provider: 'syft', state: 'ready' }),
  ]);

  await runtime.assets.warm('syft');
  expect(syft.pullImage).toHaveBeenCalledWith(expect.any(String), undefined, 3000);
  expect(syft.run).not.toHaveBeenCalled();
});

test('warms Trivy with a bounded database-only command and forwards pull authentication', async () => {
  const trivy = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({
      scanner: 'trivy',
      trivy: { workerImage: `aquasec/trivy@sha256:${'a'.repeat(64)}`, timeout: 1501 },
      sbom: { enabled: false },
    }),
    backends: { trivy },
  });

  await runtime.assets.pull('trivy', { username: 'robot', password: 'secret' });
  await runtime.assets.warm('trivy');

  expect(trivy.pullImage).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    { username: 'robot', password: 'secret' },
    1501,
  );
  expect(trivy.run).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ['image', '--download-db-only', '--timeout', '2s'],
      env: { TRIVY_CACHE_DIR: '/cache', TMPDIR: '/scratch' },
    }),
  );
});

test('builds and caches the default socket runtime with named provider cache volumes', () => {
  const runtime = getDefaultScannerRuntime();
  const cached = getDefaultScannerRuntime();

  expect(cached).toBe(runtime);
  expect(mockDockerConstructor).toHaveBeenCalledOnce();
  expect(mockDockerConstructor).toHaveBeenCalledWith({ socketPath: '/var/run/docker.sock' });
  expect(mockCreateDockerScannerBackend).toHaveBeenCalledTimes(4);
  expect(mockCreateDockerScannerBackend).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      client: mockDockerClient,
      cacheDir: 'volume:drydock-scanner-trivy',
      hardening: { networkMode: 'bridge', scratchTarget: '/scratch' },
    }),
  );
});

test('rebuilds the default runtime for TCP Docker changes and builds for command configuration', () => {
  getDefaultScannerRuntime();
  mockGetSecurityConfiguration.mockReturnValue(
    createConfiguration({
      docker: {
        ...createConfiguration().docker,
        host: 'scanner-docker.internal',
        port: 2376,
        protocol: 'https',
      },
    }),
  );

  getDefaultScannerRuntime();
  expect(mockDockerConstructor).toHaveBeenLastCalledWith({
    host: 'scanner-docker.internal',
    port: 2376,
    protocol: 'https',
  });

  clearDefaultScannerRuntime();
  mockGetSecurityConfiguration.mockReturnValue(
    createConfiguration({ backend: 'command', scanner: '', sbom: { enabled: false } }),
  );
  expect(getDefaultScannerRuntime().sbomGenerator).toBe('trivy');
  expect(mockCreateDockerScannerBackend).toHaveBeenCalledTimes(12);
});

test('maps default runtime asset audit lifecycle outcomes without exposing worker internals', async () => {
  const successful = createBackend();
  mockCreateDockerScannerBackend
    .mockImplementationOnce(() => successful)
    .mockImplementation(() => createBackend());
  const runtime = getDefaultScannerRuntime();

  await runtime.assets.pull('trivy');
  await vi.waitFor(() => expect(mockRecordAuditEvent).toHaveBeenCalledTimes(2));
  expect(mockRecordAuditEvent).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      action: 'scanner-asset-pull-started',
      status: 'info',
      details: expect.stringContaining('pulling'),
    }),
  );
  expect(mockRecordAuditEvent).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      action: 'scanner-asset-pull-succeeded',
      status: 'success',
      details: expect.stringContaining('sha256:'),
    }),
  );

  clearDefaultScannerRuntime();
  mockGetSecurityConfiguration.mockReturnValue(
    createConfiguration({ docker: { ...createConfiguration().docker, network: 'scanner-net' } }),
  );
  const failing = createBackend();
  failing.pullImage.mockRejectedValue(new Error('registry unavailable'));
  mockCreateDockerScannerBackend
    .mockImplementationOnce(() => failing)
    .mockImplementation(() => createBackend());

  await expect(getDefaultScannerRuntime().assets.pull('trivy')).rejects.toThrow(
    'registry unavailable',
  );
  await vi.waitFor(() =>
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'scanner-asset-pull-failed',
        status: 'error',
        details: expect.stringContaining('registry unavailable'),
      }),
    ),
  );
});

test('scanner workers spill temporary data to the per-worker scratch volume, not the cache or the 64 MiB tmpfs', async () => {
  const syft = createBackend();
  const runtime = createScannerRuntime({
    configuration: createConfiguration({ scanner: 'grype', sbom: { enabled: true } }),
    backends: { grype: createBackend(), syft },
  });

  await runtime.run({
    provider: 'syft',
    args: ['registry:registry/app:1'],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });

  expect(syft.run).toHaveBeenCalledWith(
    expect.objectContaining({ env: { SYFT_CACHE_DIR: '/cache', TMPDIR: '/scratch' } }),
  );
});

test('default runtime gives scanner workers (not cosign) a scratch mount', () => {
  getDefaultScannerRuntime();

  const hardeningByCacheDir = Object.fromEntries(
    mockCreateDockerScannerBackend.mock.calls.map(([options]) => [
      options.cacheDir,
      options.hardening,
    ]),
  );
  for (const provider of ['trivy', 'grype', 'syft']) {
    expect(hardeningByCacheDir[`volume:drydock-scanner-${provider}`]).toEqual({
      networkMode: 'bridge',
      scratchTarget: '/scratch',
    });
  }
  expect(hardeningByCacheDir['volume:drydock-scanner-cosign']).toEqual({ networkMode: 'bridge' });
});
