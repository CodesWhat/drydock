import { beforeEach, vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
const mockDockerConstructor = vi.hoisted(() => vi.fn());
const mockCreateDockerScannerBackend = vi.hoisted(() => vi.fn());
const mockRecordAuditEvent = vi.hoisted(() => vi.fn());
const mockDockerClient = vi.hoisted(() => ({ modem: {} }));

vi.mock('../configuration/index.js', () => ({
  getSecurityConfiguration: (...args: unknown[]) => mockGetSecurityConfiguration(...args),
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
      TRIVY_USERNAME: 'user',
      TRIVY_PASSWORD: 'token',
    },
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });
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
      env: { GRYPE_DB_CACHE_DIR: '/cache' },
    }),
  );
  expect((await runtime.assets.status())[0]).toMatchObject({
    provider: 'grype',
    state: 'ready',
    version: '1.2.3',
  });
});

test('rejects command backend because it does not use Docker worker assets', () => {
  expect(() =>
    createScannerRuntime({
      configuration: createConfiguration({ backend: 'command' }),
      backends: {},
    }),
  ).toThrow('Docker scanner runtime requires docker or remote backend');
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
      env: { TRIVY_CACHE_DIR: '/cache' },
    }),
  );
});

test('builds and caches the default socket runtime with named provider cache volumes', () => {
  const runtime = getDefaultScannerRuntime();
  const cached = getDefaultScannerRuntime();

  expect(cached).toBe(runtime);
  expect(mockDockerConstructor).toHaveBeenCalledOnce();
  expect(mockDockerConstructor).toHaveBeenCalledWith({ socketPath: '/var/run/docker.sock' });
  expect(mockCreateDockerScannerBackend).toHaveBeenCalledTimes(3);
  expect(mockCreateDockerScannerBackend).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      client: mockDockerClient,
      cacheDir: 'volume:drydock-scanner-trivy',
      hardening: { networkMode: 'bridge' },
    }),
  );
});

test('rebuilds the default runtime for TCP Docker changes and rejects command configuration', () => {
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
  mockGetSecurityConfiguration.mockReturnValue(createConfiguration({ backend: 'command' }));
  expect(() => getDefaultScannerRuntime()).toThrow('Docker scanner runtime is not configured');
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
