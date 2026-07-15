import { vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());

const mockHasValidCommandPath = vi.hoisted(() => vi.fn());
const mockWarmTrivyDatabase = vi.hoisted(() => vi.fn(async () => 'ready'));
const mockDockerRuntime = vi.hoisted(() => ({
  run: vi.fn(),
  assets: {
    get: vi.fn(() => ({ state: 'ready' })),
    warm: vi.fn(),
  },
  sbomGenerator: 'trivy' as 'trivy' | 'syft',
}));
const warmupFactoryControl = vi.hoisted(() => ({
  options: undefined as
    | {
        execute: (operation: () => Promise<void>) => Promise<void>;
        getConfiguration: () => unknown;
        run: (command: { command: string; args: string[]; timeoutMs: number }) => Promise<void>;
        onFailure: (error: unknown) => void;
      }
    | undefined,
}));

const childProcessControl = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('../configuration/index.js', async () => {
  const actual = await vi.importActual<typeof import('../configuration/index.js')>(
    '../configuration/index.js',
  );
  return {
    ...actual,
    getSecurityConfiguration: (...args: unknown[]) => mockGetSecurityConfiguration(...args),
  };
});

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('./runtime.js', () => ({
  hasValidCommandPath: (...args: unknown[]) => mockHasValidCommandPath(...args),
}));

vi.mock('./scanner-runtime.js', () => ({
  getDefaultScannerRuntime: () => mockDockerRuntime,
}));

vi.mock('./trivy-warmup.js', async () => {
  const actual = await vi.importActual<typeof import('./trivy-warmup.js')>('./trivy-warmup.js');
  return {
    ...actual,
    createTrivyDatabaseWarmup: (options: NonNullable<typeof warmupFactoryControl.options>) => {
      warmupFactoryControl.options = options;
      return mockWarmTrivyDatabase;
    },
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      if (childProcessControl.execFileImpl !== null) {
        return childProcessControl.execFileImpl(...args);
      }
      return (actual.execFile as (...callArgs: unknown[]) => unknown)(...args);
    },
  };
});

import {
  _resetErrorRetryFloorForTesting,
  _resetTrivyQueueForTesting,
  _setTrivyQueueRejectedForTesting,
  clearDigestScanCache,
  DIGEST_SCAN_CACHE_MAX_ENTRIES,
  generateImageSbom,
  getDigestScanCacheSize,
  scanImageForVulnerabilities,
  scanImageWithDedup,
  toPositiveInteger,
  updateDigestScanCache,
  verifyImageSignature,
} from './scan.js';

function createEnabledConfiguration() {
  return {
    enabled: true,
    scanner: 'trivy',
    backend: 'command',
    availabilityPolicy: 'block',
    blockSeverities: ['CRITICAL', 'HIGH'],
    trivy: {
      server: '',
      command: 'trivy',
      timeout: 120000,
      imageSrc: '',
      workerImage: 'aquasec/trivy@sha256:test',
    },
    grype: {
      command: 'grype',
      timeout: 120000,
      workerImage: 'anchore/grype@sha256:test',
    },
    signature: {
      verify: true,
      cosign: {
        command: 'cosign',
        timeout: 60000,
        key: '',
        identity: '',
        issuer: '',
      },
    },
    sbom: {
      enabled: true,
      formats: ['spdx-json'],
      generator: 'auto',
    },
    syft: {
      command: 'syft',
      timeout: 120000,
      workerImage: 'anchore/syft@sha256:test',
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  childProcessControl.execFileImpl = null;
  _resetTrivyQueueForTesting();
  clearDigestScanCache();
  _resetErrorRetryFloorForTesting();
  mockHasValidCommandPath.mockReturnValue(true);
  mockWarmTrivyDatabase.mockResolvedValue('ready');
  mockDockerRuntime.run.mockResolvedValue(JSON.stringify({ Results: [] }));
  mockDockerRuntime.assets.get.mockReturnValue({ state: 'ready' });
  mockDockerRuntime.assets.warm.mockResolvedValue({ state: 'ready' });
  mockDockerRuntime.sbomGenerator = 'trivy';
  mockGetSecurityConfiguration.mockReturnValue(createEnabledConfiguration());
});

test('toPositiveInteger should return parsed positive values', () => {
  expect(toPositiveInteger('42', 500)).toBe(42);
});

test('scanImageForVulnerabilities should return error result when scanner disabled', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    enabled: false,
    scanner: '',
  });

  const scanResult = await scanImageForVulnerabilities({
    image: 'registry.example.com/app:1.2.3',
  });

  expect(scanResult.status).toBe('error');
  expect(scanResult.error).toContain('disabled');
});

test('scanImageForVulnerabilities should await database warm-up before starting Trivy', async () => {
  const events: string[] = [];
  mockWarmTrivyDatabase.mockImplementationOnce(async () => {
    events.push('warmup-started');
    await Promise.resolve();
    events.push('warmup-finished');
    return 'ready';
  });
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    events.push('scan-started');
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('passed');
  expect(events).toEqual(['warmup-started', 'warmup-finished', 'scan-started']);
});

test('scanImageForVulnerabilities should run and normalize Grype without warming Trivy', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(
      null,
      JSON.stringify({
        matches: [
          {
            artifact: { name: 'openssl', version: '3.0.0', locations: [{ path: '/lib' }] },
            vulnerability: {
              id: 'CVE-2026-1',
              severity: 'Critical',
              fix: { versions: ['3.0.1'] },
            },
          },
        ],
      }),
      '',
    );
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result).toMatchObject({
    scanner: 'grype',
    status: 'blocked',
    blockingCount: 1,
    vulnerabilities: [
      expect.objectContaining({
        id: 'CVE-2026-1',
        packageName: 'openssl',
        severity: 'CRITICAL',
      }),
    ],
  });
  expect(mockWarmTrivyDatabase).not.toHaveBeenCalled();
  expect(execFileMock).toHaveBeenCalledWith(
    'grype',
    ['--output', 'json', 'registry:registry.example/app:1'],
    expect.objectContaining({ timeout: 120000 }),
    expect.any(Function),
  );
});

test('both provider mode deduplicates findings and records provider provenance', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'both',
  });
  childProcessControl.execFileImpl = (command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(
        null,
        JSON.stringify({
          Results: [
            {
              Target: '/lib',
              Vulnerabilities: [
                {
                  VulnerabilityID: 'CVE-2026-1',
                  PkgName: 'openssl',
                  InstalledVersion: '3.0.0',
                  Severity: 'HIGH',
                },
              ],
            },
          ],
        }),
        '',
      );
    } else {
      callback(
        null,
        JSON.stringify({
          matches: [
            {
              artifact: { name: 'openssl', version: '3.0.0', locations: [{ path: '/lib' }] },
              vulnerability: { id: 'CVE-2026-1', severity: 'High' },
            },
          ],
        }),
        '',
      );
    }
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result).toMatchObject({ scanner: 'both', status: 'blocked', blockingCount: 1 });
  expect(result.vulnerabilities).toHaveLength(1);
  expect(result.vulnerabilities[0].scanners).toEqual(['grype', 'trivy']);
});

test('both provider mode preserves known blocking findings when the other provider fails', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'both',
  });
  childProcessControl.execFileImpl = (command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(
        null,
        JSON.stringify({
          Results: [
            {
              Vulnerabilities: [
                { VulnerabilityID: 'CVE-BLOCK', PkgName: 'pkg', Severity: 'CRITICAL' },
              ],
            },
          ],
        }),
        '',
      );
      return { exitCode: 0 };
    }
    const error = Object.assign(new Error('failed'), { code: '1' });
    callback(error, '', 'database unavailable');
    return { exitCode: 1 };
  };

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result.status).toBe('blocked');
  expect(result.blockingCount).toBe(1);
  expect(result.error).toContain('Grype');
});

test('Docker backend executes Trivy through the worker runtime without a local command', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    backend: 'docker',
  });
  mockDockerRuntime.run.mockResolvedValueOnce(JSON.stringify({ Results: [] }));

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result.status).toBe('passed');
  expect(childProcessControl.execFileImpl).toBeNull();
  expect(mockWarmTrivyDatabase).not.toHaveBeenCalled();
  expect(mockDockerRuntime.run).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'trivy',
      args: expect.arrayContaining(['image', '--format', 'json', 'registry.example/app:1']),
    }),
  );
});

test('Grype-only auto SBOM mode generates documents with Syft', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
    sbom: { enabled: true, formats: ['cyclonedx-json'], generator: 'auto' },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ bomFormat: 'CycloneDX' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await generateImageSbom({ image: 'registry.example/app:1' });

  expect(result).toMatchObject({ generator: 'syft', status: 'generated' });
  expect(execFileMock).toHaveBeenCalledWith(
    'syft',
    ['registry:registry.example/app:1', '--output', 'cyclonedx-json'],
    expect.objectContaining({ timeout: 120000 }),
    expect.any(Function),
  );
});

test('Trivy warm-up adapter should serialize and run the database command with process grace', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, '', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;
  const adapter = warmupFactoryControl.options;
  expect(adapter).toBeDefined();
  expect(adapter?.getConfiguration()).toEqual(createEnabledConfiguration());

  await adapter?.execute(() =>
    adapter.run({
      command: 'trivy',
      args: ['image', '--download-db-only', '--timeout', '600s'],
      timeoutMs: 600_000,
    }),
  );

  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    ['image', '--download-db-only', '--timeout', '600s'],
    expect.objectContaining({ timeout: 630_000 }),
    expect.any(Function),
  );
});

test('Trivy warm-up adapter should reject an invalid command path and tolerate failure logging', async () => {
  const adapter = warmupFactoryControl.options;
  expect(adapter).toBeDefined();
  mockHasValidCommandPath.mockReturnValueOnce(false);

  await expect(adapter?.run({ command: '../trivy', args: [], timeoutMs: 600_000 })).rejects.toThrow(
    'invalid',
  );
  expect(() => adapter?.onFailure(new Error('registry unavailable'))).not.toThrow();
});

test('scanImageForVulnerabilities should parse trivy output and block by severity', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      server: 'http://trivy:4954',
    },
  });

  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(
      null,
      JSON.stringify({
        Results: [
          {
            Target: 'app',
            Vulnerabilities: [
              {
                VulnerabilityID: 'CVE-1',
                Severity: 'HIGH',
                PkgName: 'openssl',
                InstalledVersion: '1.0.0',
                FixedVersion: '1.0.1',
              },
              {
                VulnerabilityID: 'CVE-2',
                Severity: 'LOW',
              },
              {
                VulnerabilityID: 'CVE-3',
                Severity: 'MEDIUM',
              },
              {
                VulnerabilityID: 'CVE-4',
                Severity: 'banana',
              },
              {
                VulnerabilityID: 'CVE-5',
                Severity: 'CRITICAL',
              },
            ],
          },
        ],
      }),
      '',
    );
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const scanResult = await scanImageForVulnerabilities({
    image: 'registry.example.com/app:1.2.3',
    auth: {
      username: 'user',
      password: 'token',
    },
  });

  expect(scanResult.status).toBe('blocked');
  expect(scanResult.blockingCount).toBe(2);
  expect(scanResult.summary).toEqual({
    unknown: 1,
    low: 1,
    medium: 1,
    high: 1,
    critical: 1,
  });
  expect(scanResult.vulnerabilities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'CVE-1',
        severity: 'HIGH',
      }),
    ]),
  );
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.arrayContaining(['image', '--format', 'json', '--server', 'http://trivy:4954']),
    expect.objectContaining({
      env: expect.objectContaining({
        TRIVY_USERNAME: 'user',
        TRIVY_PASSWORD: 'token',
      }),
    }),
    expect.any(Function),
  );
  const callArgs = execFileMock.mock.calls[0][1];
  expect(callArgs).not.toContain('--username');
  expect(callArgs).not.toContain('--password');
});

test('scanImageForVulnerabilities should return error result when trivy command fails', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const error = new Error('command failed') as NodeJS.ErrnoException;
    error.code = 'ERR_CHILD_PROCESS';
    callback(error, '', 'failed to scan');
    return { exitCode: 1 };
  };

  const scanResult = await scanImageForVulnerabilities({
    image: 'registry.example.com/app:1.2.3',
  });

  expect(scanResult.status).toBe('error');
  expect(scanResult.error).toContain('failed to scan');
});

test('verifyImageSignature should return error when disabled', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      verify: false,
      cosign: {
        command: 'cosign',
        timeout: 60000,
        key: '',
        identity: '',
        issuer: '',
      },
    },
  });

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('disabled');
});

test('verifyImageSignature should return verified when cosign succeeds', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      verify: true,
      cosign: {
        command: 'cosign',
        timeout: 60000,
        key: '/keys/cosign.pub',
        identity: 'maintainer@example.com',
        issuer: 'https://token.actions.githubusercontent.com',
      },
    },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, '{"critical":{"identity":{"docker-reference":"x"}}}', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await verifyImageSignature({
    image: 'registry.example.com/app:1.2.3',
    auth: {
      username: 'user',
      password: 'token',
    },
  });

  expect(result.status).toBe('verified');
  expect(result.keyless).toBe(false);
  expect(result.signatures).toBe(1);
  expect(execFileMock).toHaveBeenCalledWith(
    'cosign',
    expect.arrayContaining([
      'verify',
      '--output',
      'json',
      '--key',
      '/keys/cosign.pub',
      '--certificate-identity',
      'maintainer@example.com',
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      'registry.example.com/app:1.2.3',
    ]),
    expect.objectContaining({
      env: expect.objectContaining({
        COSIGN_REGISTRY_USERNAME: 'user',
        COSIGN_REGISTRY_PASSWORD: 'token',
      }),
    }),
    expect.any(Function),
  );
  const callArgs = execFileMock.mock.calls[0][1];
  expect(callArgs).not.toContain('--registry-username');
  expect(callArgs).not.toContain('--registry-password');
});

test('verifyImageSignature should parse cosign json array output', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    callback(null, '[{"sig":1},{"sig":2}]', '');
    return { exitCode: 0 };
  };

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('verified');
  expect(result.keyless).toBe(true);
  expect(result.signatures).toBe(2);
});

test('verifyImageSignature should parse line-delimited cosign output', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    callback(null, '{"sig":1}\nnot-json\n{"sig":2}', '');
    return { exitCode: 0 };
  };

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('verified');
  expect(result.signatures).toBe(2);
});

test('verifyImageSignature should handle empty cosign output', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    callback(null, '', '');
    return { exitCode: 0 };
  };

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('verified');
  expect(result.signatures).toBe(1);
});

test('verifyImageSignature should classify signature failures as unverified', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const error = new Error('command failed') as NodeJS.ErrnoException;
    error.code = '1';
    callback(error, '', 'no matching signatures: no signatures found for image');
    return { exitCode: 1 };
  };

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('unverified');
  expect(result.signatures).toBe(0);
});

test('verifyImageSignature should classify unknown failures as error', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const error = new Error('command failed') as NodeJS.ErrnoException;
    error.code = '1';
    callback(error, '', 'dial tcp timeout');
    return { exitCode: 1 };
  };

  const result = await verifyImageSignature({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('dial tcp timeout');
});

test('generateImageSbom should return error when scanner disabled', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    enabled: false,
    scanner: '',
  });

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('disabled');
});

test('generateImageSbom should generate configured formats', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: {
      enabled: true,
      formats: ['spdx-json', 'cyclonedx-json'],
    },
  });

  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const formatIndex = args.indexOf('--format');
    const format = args[formatIndex + 1];
    callback(null, JSON.stringify({ bomFormat: format, metadata: { component: 'app' } }), '');
    return { exitCode: 0 };
  };

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('generated');
  expect(result.formats).toEqual(['spdx-json', 'cyclonedx-json']);
  expect(result.documents['spdx-json']).toEqual(
    expect.objectContaining({ bomFormat: 'spdx-json' }),
  );
  expect(result.documents['cyclonedx-json']).toEqual(
    expect.objectContaining({ bomFormat: 'cyclonedx' }),
  );
});

test('generateImageSbom should keep generated status when one format fails', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: {
      enabled: true,
      formats: ['spdx-json', 'cyclonedx-json'],
    },
  });

  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const formatIndex = args.indexOf('--format');
    const format = args[formatIndex + 1];
    if (format === 'cyclonedx') {
      const error = new Error('failed') as NodeJS.ErrnoException;
      error.code = '1';
      callback(error, '', 'network error');
      return { exitCode: 1 };
    }
    callback(null, JSON.stringify({ bomFormat: format, metadata: { component: 'app' } }), '');
    return { exitCode: 0 };
  };

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('generated');
  expect(result.formats).toEqual(['spdx-json']);
  expect(result.error).toContain('cyclonedx-json');
});

test('generateImageSbom should fallback to spdx-json when configured formats are invalid', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: {
      enabled: true,
      formats: ['invalid-format'],
    },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ bomFormat: 'spdx-json' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('generated');
  expect(result.formats).toEqual(['spdx-json']);
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.arrayContaining(['--format', 'spdx-json']),
    expect.any(Object),
    expect.any(Function),
  );
});

test('generateImageSbom should return error when all formats fail', async () => {
  childProcessControl.execFileImpl = (command, args, options, callback) => {
    const error = new Error('failed') as NodeJS.ErrnoException;
    error.code = '1';
    callback(error, '', 'trivy server unavailable');
    return { exitCode: 1 };
  };

  const result = await generateImageSbom({
    image: 'registry.example.com/app:1.2.3',
    formats: ['spdx-json'],
  });

  expect(result.status).toBe('error');
  expect(result.error).toContain('unavailable');
});

test('generateImageSbom should map cyclonedx-json to cyclonedx in trivy args', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: { enabled: true, formats: ['cyclonedx-json'] },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ bomFormat: 'CycloneDX' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('generated');
  expect(result.formats).toEqual(['cyclonedx-json']);
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.arrayContaining(['--format', 'cyclonedx']),
    expect.any(Object),
    expect.any(Function),
  );
  const callArgs = execFileMock.mock.calls[0][1];
  expect(callArgs).not.toContain('cyclonedx-json');
});

test('generateImageSbom should pass spdx-json through unchanged in trivy args', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: { enabled: true, formats: ['spdx-json'] },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  expect(result.status).toBe('generated');
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.arrayContaining(['--format', 'spdx-json']),
    expect.any(Object),
    expect.any(Function),
  );
});

test('scanImageForVulnerabilities should pass json format through unchanged in trivy args', async () => {
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'registry.example.com/app:1.2.3' });

  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.arrayContaining(['--format', 'json']),
    expect.any(Object),
    expect.any(Function),
  );
});

test('Trivy process timeout should include grace beyond the configured scan timeout', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'registry.example.com/app:1.2.3' });

  expect(execFileMock.mock.calls[0][1]).toEqual(expect.arrayContaining(['--timeout', '120s']));
  expect(execFileMock.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: 150000 }));
});

test('buildTrivyArgs should NOT pass --image-src when imageSrc is empty so Trivy falls back to registry when docker.sock is unreachable', async () => {
  // imageSrc is '' in createEnabledConfiguration() — flag must be absent
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'registry.example.com/app:1.2.3' });

  const callArgs = execFileMock.mock.calls[0][1] as string[];
  expect(callArgs).not.toContain('--image-src');
});

test('buildTrivyArgs should pass --image-src when imageSrc is configured for scan args', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, imageSrc: 'remote' },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'registry.example.com/app:1.2.3' });

  const callArgs = execFileMock.mock.calls[0][1] as string[];
  const srcIndex = callArgs.indexOf('--image-src');
  expect(srcIndex).toBeGreaterThan(-1);
  expect(callArgs[srcIndex + 1]).toBe('remote');
});

test('buildTrivyArgs should NOT pass --image-src in SBOM args when imageSrc is empty so Trivy falls back to registry when docker.sock is unreachable', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: { enabled: true, formats: ['spdx-json'] },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ bomFormat: 'spdx', metadata: {} }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  const callArgs = execFileMock.mock.calls[0][1] as string[];
  expect(callArgs).not.toContain('--image-src');
});

test('buildTrivyArgs should pass --image-src when imageSrc is configured for SBOM args', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, imageSrc: 'remote' },
    sbom: { enabled: true, formats: ['spdx-json'] },
  });
  const execFileMock = vi.fn((command, args, options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await generateImageSbom({ image: 'registry.example.com/app:1.2.3' });

  const callArgs = execFileMock.mock.calls[0][1] as string[];
  const srcIndex = callArgs.indexOf('--image-src');
  expect(srcIndex).toBeGreaterThan(-1);
  expect(callArgs[srcIndex + 1]).toBe('remote');
});

test('trivy queue should serialize concurrent scan invocations', async () => {
  const order: string[] = [];

  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const index = order.filter((e) => e.startsWith('start-')).length;
    order.push(`start-${index}`);
    setTimeout(() => {
      order.push(`end-${index}`);
      callback(null, JSON.stringify({ Results: [] }), '');
    }, 50);
    return { exitCode: 0 };
  };

  await Promise.all([
    scanImageForVulnerabilities({ image: 'img:1' }),
    scanImageForVulnerabilities({ image: 'img:2' }),
  ]);

  expect(order).toEqual(['start-0', 'end-0', 'start-1', 'end-1']);
});

test('trivy queue should recover after a failed scan', async () => {
  let callCount = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callCount += 1;
    if (callCount === 1) {
      const error = new Error('cache locked') as NodeJS.ErrnoException;
      error.code = '1';
      callback(error, '', 'cache locked');
      return { exitCode: 1 };
    }
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  };

  const [first, second] = await Promise.all([
    scanImageForVulnerabilities({ image: 'img:1' }),
    scanImageForVulnerabilities({ image: 'img:2' }),
  ]);

  expect(first.status).toBe('error');
  expect(first.error).toContain('cache locked');
  expect(second.status).toBe('passed');
});

test('trivy queue should recover when previous queue tail is rejected', async () => {
  _setTrivyQueueRejectedForTesting();
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:rejected-tail' });

  expect(result.status).toBe('passed');
});

// --- Branch coverage tests ---

test('normalizeSeverity should fall back to UNKNOWN when severity is undefined', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(
      null,
      JSON.stringify({
        Results: [
          { Target: 'app', Vulnerabilities: [{ VulnerabilityID: 'CVE-99', Severity: undefined }] },
        ],
      }),
      '',
    );
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities[0].severity).toBe('UNKNOWN');
});

test('normalizeSeverity should fall back to UNKNOWN when severity is empty string', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(
      null,
      JSON.stringify({
        Results: [
          { Target: 'app', Vulnerabilities: [{ VulnerabilityID: 'CVE-99', Severity: '' }] },
        ],
      }),
      '',
    );
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities[0].severity).toBe('UNKNOWN');
});

test('parseTrivyOutput should handle missing Results key', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, JSON.stringify({}), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('passed');
  expect(result.vulnerabilities).toEqual([]);
});

test('parseTrivyOutput should handle non-string Target', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(
      null,
      JSON.stringify({
        Results: [
          { Target: 12345, Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'LOW' }] },
        ],
      }),
      '',
    );
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities[0].target).toBeUndefined();
  expect(result.vulnerabilities[0].id).toBe('CVE-1');
});

test('parseTrivyOutput should handle missing Vulnerabilities array', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [{ Target: 'app' }] }), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities).toEqual([]);
});

test('parseTrivyOutput should handle missing VulnerabilityID', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(
      null,
      JSON.stringify({
        Results: [{ Target: 'app', Vulnerabilities: [{ Severity: 'HIGH' }] }],
      }),
      '',
    );
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities[0].id).toBe('unknown-vulnerability');
});

test('scanImageForVulnerabilities should reject oversized trivy output before parsing', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, 'x'.repeat(21 * 1024 * 1024), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('too large to parse');
});

test('runCommand should use process.env when no env option provided', async () => {
  const execFileMock = vi.fn((_command, _args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  // When no auth is provided, buildTrivyEnvironment still returns a copy of process.env,
  // so env is always set. This test verifies that path works.
  await scanImageForVulnerabilities({ image: 'img:test' });

  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    expect.any(Array),
    expect.objectContaining({ env: expect.any(Object) }),
    expect.any(Function),
  );
});

test('runCommand should handle failure with no stderr and no error code', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const error = new Error('') as NodeJS.ErrnoException;
    // No code set, no stderr — use setTimeout so child is assigned before callback
    const child = { exitCode: null };
    setTimeout(() => callback(error, '', ''), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('unknown error');
});

test('runCommand should handle failure with empty error message and empty stderr', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const error = new Error('') as NodeJS.ErrnoException;
    error.code = undefined;
    const child = { exitCode: null };
    setTimeout(() => callback(error, '', '   '), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  // stderr is whitespace only -> trims to '' -> falls back to error.message '' -> falls back to 'unknown error'
  expect(result.error).toContain('unknown error');
});

test('runCommand should report an honest timeout when Node kills Trivy', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const error = new Error('Command failed') as NodeJS.ErrnoException & {
      killed: boolean;
      signal: string;
    };
    error.code = undefined;
    error.killed = true;
    error.signal = 'SIGTERM';
    const child = { exitCode: null };
    setTimeout(() => callback(error, '', ''), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('process timed out after 150000ms');
  expect(result.error).toContain('configured timeout 120000ms');
  expect(result.error).not.toContain('exit=unknown');
});

test('runCommand should report the configured deadline when Trivy times itself out', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const error = new Error('Command failed') as NodeJS.ErrnoException;
    error.code = '1';
    const child = { exitCode: 1 };
    setTimeout(() => callback(error, '', 'context deadline exceeded'), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('timed out after 120000ms');
  expect(result.error).not.toContain('150000ms');
});

test('runCommand should report a process timeout without optional timeout metadata', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    const error = new Error('') as NodeJS.ErrnoException & {
      killed: boolean;
      signal: string;
    };
    error.code = undefined;
    error.killed = true;
    error.signal = 'SIGTERM';
    const child = { exitCode: null };
    setTimeout(() => callback(error, '', ''), 0);
    return child;
  };

  const result = await verifyImageSignature({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('Cosign process timed out after 60000ms (configured timeout 60000ms)');
});

test('scanImageForVulnerabilities should retry one transient Trivy failure when requested', async () => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const child = { exitCode: invocations === 1 ? 1 : 0 };
    if (invocations === 1) {
      const error = new Error('temporary registry timeout') as NodeJS.ErrnoException;
      error.code = 'ETIMEDOUT';
      setTimeout(() => callback(error, '', 'request timed out'), 0);
    } else {
      setTimeout(() => callback(null, JSON.stringify({ Results: [] }), ''), 0);
    }
    return child;
  };

  const options = { image: 'img:test', retryTransient: true };
  const result = await scanImageForVulnerabilities(options);

  expect(result.status).toBe('passed');
  expect(invocations).toBe(2);
});

test('scanImageForVulnerabilities should not retry permanent Trivy failures', async () => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const error = new Error('authentication failed') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    const child = { exitCode: 1 };
    setTimeout(() => callback(error, '', 'unauthorized'), 0);
    return child;
  };

  const options = { image: 'img:test', retryTransient: true };
  const result = await scanImageForVulnerabilities(options);

  expect(result.status).toBe('error');
  expect(invocations).toBe(1);
});

test('scanImageForVulnerabilities should not retry invalid timeout configuration errors', async () => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const error = new Error('invalid timeout configuration') as NodeJS.ErrnoException;
    error.code = 'EINVAL';
    const child = { exitCode: 1 };
    setTimeout(() => callback(error, '', 'invalid timeout value'), 0);
    return child;
  };

  const options = { image: 'img:test', retryTransient: true };
  const result = await scanImageForVulnerabilities(options);

  expect(result.status).toBe('error');
  expect(invocations).toBe(1);
});

test.each([
  'dial tcp 10.0.0.2:443: i/o timeout',
  'net/http: TLS handshake timeout',
  'dial tcp 10.0.0.2:443: connect: connection refused',
  'lookup registry.example.com: no such host',
])('scanImageForVulnerabilities should retry realistic transient Trivy stderr: %s', async (stderr) => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const child = { exitCode: invocations === 1 ? 1 : 0 };
    if (invocations === 1) {
      const error = new Error('Trivy failed') as NodeJS.ErrnoException;
      error.code = '1';
      setTimeout(() => callback(error, '', stderr), 0);
    } else {
      setTimeout(() => callback(null, JSON.stringify({ Results: [] }), ''), 0);
    }
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test', retryTransient: true });

  expect(result.status).toBe('passed');
  expect(invocations).toBe(2);
});

test('scanImageForVulnerabilities should stop after two transient failures', async () => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const error = new Error('Trivy failed') as NodeJS.ErrnoException;
    error.code = '1';
    const child = { exitCode: 1 };
    setTimeout(() => callback(error, '', 'dial tcp: i/o timeout'), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test', retryTransient: true });

  expect(result.status).toBe('error');
  expect(invocations).toBe(2);
});

test('scanImageForVulnerabilities should not retry max-buffer kills', async () => {
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    const error = new Error('stdout maxBuffer length exceeded') as NodeJS.ErrnoException & {
      killed: boolean;
      signal: string;
    };
    error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    error.killed = true;
    error.signal = 'SIGTERM';
    const child = { exitCode: null };
    setTimeout(() => callback(error, '', ''), 0);
    return child;
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test', retryTransient: true });

  expect(result.status).toBe('error');
  expect(invocations).toBe(1);
});

test('Trivy SBOM process timeout should include grace beyond the configured timeout', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await generateImageSbom({ image: 'img:test', formats: ['spdx-json'] });

  expect(execFileMock.mock.calls[0][1]).toEqual(expect.arrayContaining(['--timeout', '120s']));
  expect(execFileMock.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: 150000 }));
});

test('buildTrivyEnvironment should not set auth env when password is undefined', async () => {
  const execFileMock = vi.fn((_command, _args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({
    image: 'img:test',
    auth: { username: 'user', password: undefined },
  });

  const envUsed = execFileMock.mock.calls[0][2].env;
  expect(envUsed).not.toHaveProperty('TRIVY_USERNAME');
  expect(envUsed).not.toHaveProperty('TRIVY_PASSWORD');
});

test('runTrivyVulnerabilityCommand should fallback to trivy when command is empty', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, command: '' },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('trivy');
});

test('runTrivyVulnerabilityCommand should fallback to trivy when command is whitespace', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, command: '   ' },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('trivy');
});

test('scanImageForVulnerabilities should reject invalid trivy command path before execution', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      command: '../bin/trivy',
    },
  });
  mockHasValidCommandPath.mockReturnValue(false);
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(mockHasValidCommandPath).toHaveBeenCalledWith('../bin/trivy');
  expect(execFileMock).not.toHaveBeenCalled();
  expect(result.status).toBe('error');
  expect(result.error).toContain('invalid');
});

test('runTrivySbomCommand should fallback to trivy when command is empty', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, command: '' },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await generateImageSbom({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('trivy');
});

test('runTrivySbomCommand should fallback to trivy when command is whitespace', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, command: '   ' },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await generateImageSbom({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('trivy');
});

test('generateImageSbom should reject invalid trivy command path before execution', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      command: '../bin/trivy',
    },
  });
  mockHasValidCommandPath.mockReturnValue(false);
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await generateImageSbom({ image: 'img:test' });

  expect(mockHasValidCommandPath).toHaveBeenCalledWith('../bin/trivy');
  expect(execFileMock).not.toHaveBeenCalled();
  expect(result.status).toBe('error');
  expect(result.error).toContain('invalid');
});

test('runCosignVerifyCommand should fallback to cosign when command is empty', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      ...createEnabledConfiguration().signature,
      cosign: { ...createEnabledConfiguration().signature.cosign, command: '' },
    },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, '[{"sig":1}]', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await verifyImageSignature({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('cosign');
});

test('runCosignVerifyCommand should fallback to cosign when command is whitespace', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      ...createEnabledConfiguration().signature,
      cosign: { ...createEnabledConfiguration().signature.cosign, command: '   ' },
    },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, '[{"sig":1}]', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await verifyImageSignature({ image: 'img:test' });

  expect(execFileMock.mock.calls[0][0]).toBe('cosign');
});

test('verifyImageSignature should reject invalid cosign command path before execution', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      ...createEnabledConfiguration().signature,
      cosign: {
        ...createEnabledConfiguration().signature.cosign,
        command: '../bin/cosign',
      },
    },
  });
  mockHasValidCommandPath.mockReturnValue(false);
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, '[{"sig":1}]', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await verifyImageSignature({ image: 'img:test' });

  expect(mockHasValidCommandPath).toHaveBeenCalledWith('../bin/cosign');
  expect(execFileMock).not.toHaveBeenCalled();
  expect(result.status).toBe('error');
  expect(result.error).toContain('invalid');
});

test('parseCosignSignaturesCount should return 1 for non-array JSON object', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, '{"critical":{"identity":{}}}', '');
    return { exitCode: 0 };
  };

  const result = await verifyImageSignature({ image: 'img:test' });

  // Non-array object returns 1 signature count, minimum kept as 1
  expect(result.signatures).toBe(1);
});

test('scanImageForVulnerabilities catch should handle error with no message property', async () => {
  // Throw a non-Error so catch receives something without .message
  childProcessControl.execFileImpl = () => {
    throw 'bare string';
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('Unknown security scan error');
});

test('scanImageForVulnerabilities catch should stringify non-string truthy message fields', async () => {
  childProcessControl.execFileImpl = () => {
    throw { message: { reason: 'malformed output' } };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('[object Object]');
});

test('scanImageForVulnerabilities catch should use fallback when thrown object has no message', async () => {
  childProcessControl.execFileImpl = () => {
    throw {};
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('Unknown security scan error');
});

test('scanImageForVulnerabilities catch should use fallback when thrown object has an empty message', async () => {
  childProcessControl.execFileImpl = () => {
    throw { message: '' };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('Unknown security scan error');
});

test('verifyImageSignature catch should handle error with no message property', async () => {
  childProcessControl.execFileImpl = () => {
    throw 'bare string';
  };

  const result = await verifyImageSignature({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toBe('Unknown signature verification error');
});

test('generateImageSbom catch should handle error with no message property', async () => {
  childProcessControl.execFileImpl = () => {
    throw 'bare string';
  };

  const result = await generateImageSbom({ image: 'img:test', formats: ['spdx-json'] });

  expect(result.status).toBe('error');
  // errors.push(`${format}: ${error?.message || 'Unknown SBOM generation error'}`)
  expect(result.error).toContain('Unknown SBOM generation error');
});

test('generateImageSbom error join fallback when catch produces empty-looking messages', async () => {
  // Throw non-Error objects so error?.message is undefined -> fallback text is used
  childProcessControl.execFileImpl = () => {
    throw null;
  };

  const result = await generateImageSbom({ image: 'img:test', formats: ['spdx-json'] });

  expect(result.status).toBe('error');
  // errors.push produces 'spdx-json: Unknown SBOM generation error', join is non-empty
  expect(result.error).toContain('Unknown SBOM generation error');
});

test('buildTrivyEnvironment should use empty string for username when password is set but username is undefined', async () => {
  const execFileMock = vi.fn((_command, _args, options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  await scanImageForVulnerabilities({
    image: 'img:test',
    auth: { password: 'secret' },
  });

  const envUsed = execFileMock.mock.calls[0][2].env;
  expect(envUsed.TRIVY_USERNAME).toBe('');
  expect(envUsed.TRIVY_PASSWORD).toBe('secret');
});

test('Docker backend warms missing Trivy assets before scanning', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    backend: 'docker',
  });
  mockDockerRuntime.assets.get.mockReturnValue({ state: 'missing' });
  mockDockerRuntime.run.mockResolvedValueOnce(JSON.stringify({ Results: [] }));

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result.status).toBe('passed');
  expect(mockDockerRuntime.assets.warm).toHaveBeenCalledWith('trivy');
  expect(mockDockerRuntime.run).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'trivy' }),
  );
});

test('Docker backend warms missing Grype assets and runs Grype without a local command', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
    backend: 'docker',
  });
  mockDockerRuntime.assets.get.mockReturnValue({ state: 'missing' });
  mockDockerRuntime.run.mockResolvedValueOnce(JSON.stringify({ matches: [] }));

  const result = await scanImageForVulnerabilities({ image: 'registry.example/app:1' });

  expect(result.status).toBe('passed');
  expect(mockDockerRuntime.assets.warm).toHaveBeenCalledWith('grype');
  expect(mockDockerRuntime.run).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'grype',
      args: expect.arrayContaining(['registry:registry.example/app:1']),
    }),
  );
});

test('Docker backend generates an explicit Trivy SBOM through the worker runtime', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    backend: 'docker',
    sbom: { enabled: true, formats: ['spdx-json'], generator: 'trivy' },
  });
  mockDockerRuntime.run.mockResolvedValueOnce(JSON.stringify({ spdxVersion: 'SPDX-2.3' }));

  const result = await generateImageSbom({ image: 'registry.example/app:1' });

  expect(result).toMatchObject({ generator: 'trivy', status: 'generated' });
  expect(mockDockerRuntime.run).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'trivy' }),
  );
});

test('Docker backend generates an explicit Syft SBOM with password-only registry auth', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    backend: 'docker',
    sbom: { enabled: true, formats: ['spdx-json'], generator: 'syft' },
  });
  mockDockerRuntime.run.mockResolvedValueOnce(JSON.stringify({ spdxVersion: 'SPDX-2.3' }));

  const result = await generateImageSbom({
    image: 'registry.example/app:1',
    auth: { password: 'secret' },
  });

  expect(result).toMatchObject({ generator: 'syft', status: 'generated' });
  expect(mockDockerRuntime.run).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'syft',
      env: expect.objectContaining({
        SYFT_REGISTRY_AUTH_USERNAME: '',
        SYFT_REGISTRY_AUTH_PASSWORD: 'secret',
      }),
    }),
  );
});

test('rejects Trivy extra arguments that override a protected option', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, extraArgs: ['--format=table'] },
  });

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('Trivy extra arguments cannot override --format');
});

test.each([
  ['-f', '-f'],
  ['-f=table', '-f'],
  ['-o', '-o'],
  ['-o=report.json', '-o'],
  ['-s', '-s'],
  ['-s=LOW', '-s'],
])('rejects Trivy short alias %s for a protected option', async (argument, flag) => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: { ...createEnabledConfiguration().trivy, extraArgs: [argument] },
  });

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain(`Trivy extra arguments cannot override ${flag}`);
});

test('passes non-protected Trivy extra arguments to the scanner', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      extraArgs: ['--skip-dirs', '/tmp/cache'],
    },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ Results: [] }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('passed');
  expect(execFileMock.mock.calls[0][1]).toEqual(
    expect.arrayContaining(['--skip-dirs', '/tmp/cache']),
  );
});

test('rejects Syft extra arguments that override a protected option', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: { enabled: true, formats: ['spdx-json'], generator: 'syft' },
    syft: { ...createEnabledConfiguration().syft, extraArgs: ['-o'] },
  });

  const result = await generateImageSbom({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('Syft extra arguments cannot override -o');
});

test('rejects invalid Syft command paths before execution', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    sbom: { enabled: true, formats: ['spdx-json'], generator: 'syft' },
    syft: { ...createEnabledConfiguration().syft, command: '../bin/syft' },
  });
  mockHasValidCommandPath.mockReturnValue(false);

  const result = await generateImageSbom({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('Syft command');
  expect(mockDockerRuntime.run).not.toHaveBeenCalled();
});

test('falls back to the Syft command for missing and whitespace-only configuration', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, JSON.stringify({ spdxVersion: 'SPDX-2.3' }), '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  for (const command of [undefined, '   ']) {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      sbom: { enabled: true, formats: ['spdx-json'], generator: 'syft' },
      syft: { ...createEnabledConfiguration().syft, command },
    });

    await expect(generateImageSbom({ image: 'img:test' })).resolves.toMatchObject({
      status: 'generated',
    });
  }

  expect(execFileMock.mock.calls.map((call) => call[0])).toEqual(['syft', 'syft']);
});

test('retries a transient Grype command failure once', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
  });
  let invocations = 0;
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    invocations += 1;
    if (invocations === 1) {
      const error = Object.assign(new Error('temporary registry failure'), { code: 'EAI_AGAIN' });
      callback(error, '', 'temporary failure in name resolution');
      return { exitCode: 1 };
    }
    callback(null, JSON.stringify({ matches: [] }), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({
    image: 'img:test',
    retryTransient: true,
  });

  expect(result.status).toBe('passed');
  expect(invocations).toBe(2);
});

test.each([
  ['a permanent Error', new Error('authentication failed')],
  ['a non-Error rejection', 'malformed rejection'],
])('does not retry %s from the Docker scanner runtime', async (_label, failure) => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
    backend: 'docker',
  });
  mockDockerRuntime.run.mockRejectedValueOnce(failure);

  const result = await scanImageForVulnerabilities({
    image: 'img:test',
    retryTransient: true,
  });

  expect(result.status).toBe('error');
  expect(mockDockerRuntime.run).toHaveBeenCalledOnce();
});

test('retries a transient plain Error from the Docker scanner runtime', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'grype',
    backend: 'docker',
  });
  mockDockerRuntime.run
    .mockRejectedValueOnce(new Error('registry connection reset'))
    .mockResolvedValueOnce(JSON.stringify({ matches: [] }));

  const result = await scanImageForVulnerabilities({
    image: 'img:test',
    retryTransient: true,
  });

  expect(result.status).toBe('passed');
  expect(mockDockerRuntime.run).toHaveBeenCalledTimes(2);
});

test('both-provider merge upgrades severity for a duplicate without package metadata', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'both',
  });
  childProcessControl.execFileImpl = (command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(
        null,
        JSON.stringify({
          Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'HIGH' }] }],
        }),
        '',
      );
    } else {
      callback(
        null,
        JSON.stringify({
          matches: [{ artifact: {}, vulnerability: { id: 'CVE-1', severity: 'Critical' } }],
        }),
        '',
      );
    }
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.vulnerabilities).toEqual([
    expect.objectContaining({ severity: 'CRITICAL', scanners: ['grype', 'trivy'] }),
  ]);
});

test('both-provider errors identify a failed Trivy provider', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    scanner: 'both',
  });
  childProcessControl.execFileImpl = (command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(Object.assign(new Error('failed'), { code: '1' }), '', 'database unavailable');
      return { exitCode: 1 };
    }
    callback(null, JSON.stringify({ matches: [] }), '');
    return { exitCode: 0 };
  };

  const result = await scanImageForVulnerabilities({ image: 'img:test' });

  expect(result.status).toBe('error');
  expect(result.error).toContain('Trivy:');
});

test('parseCosignSignaturesCount should return 0 for JSON primitive (non-object, non-array)', async () => {
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    // JSON.parse('42') is a number — not array, not object → falls through to line-delimited parsing
    callback(null, '42', '');
    return { exitCode: 0 };
  };

  const result = await verifyImageSignature({ image: 'img:test' });

  // 42 is not an object → line-delimited fallback parses '42' which is not an object → 0 sigs
  // verifyImageSignature clamps to min 1 when cosign succeeds
  expect(result.signatures).toBe(1);
  expect(result.status).toBe('verified');
});

// --- scanImageWithDedup tests ---

function createMockScanResult(image = 'registry.example.com/app:1.2.3') {
  return {
    scanner: 'trivy' as const,
    image,
    scannedAt: new Date().toISOString(),
    status: 'passed' as const,
    blockSeverities: ['CRITICAL', 'HIGH'] as Array<'CRITICAL' | 'HIGH'>,
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: [],
  };
}

describe('scanImageWithDedup', () => {
  test('does not reuse a digest cache entry after the scanner provider changes', async () => {
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };
    await scanImageWithDedup(
      { image: 'registry/app:1', digest: 'sha256:provider', trivyDbUpdatedAt: 'db-1' },
      3_600_000,
    );
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'grype',
    });
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ matches: [] }), '');
      return { exitCode: 0 };
    };

    const result = await scanImageWithDedup(
      { image: 'registry/app:1', digest: 'sha256:provider', trivyDbUpdatedAt: 'db-1' },
      3_600_000,
    );

    expect(result.fromCache).toBe(false);
    expect(result.scanResult.scanner).toBe('grype');
  });

  test('should run a fresh scan on cache miss when trivyDbUpdatedAt is provided', async () => {
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const { fromCache } = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(fromCache).toBe(false);
  });

  test('should run a fresh scan on cache miss', async () => {
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const { scanResult, fromCache } = await scanImageWithDedup(
      { image: 'registry.example.com/app:1.2.3', digest: 'sha256:abc123' },
      3_600_000,
    );

    expect(fromCache).toBe(false);
    expect(scanResult.status).toBe('passed');
    expect(scanResult.image).toBe('registry.example.com/app:1.2.3');
    expect(scanResult.imageDigest).toBe('sha256:abc123');
  });

  test('should return cached result when DB is unchanged and interval not expired', async () => {
    const cachedResult = createMockScanResult();
    updateDigestScanCache('sha256:abc123', cachedResult, '2025-01-01T00:00:00Z');

    const execFileMock = vi.fn();
    childProcessControl.execFileImpl = execFileMock;

    const { scanResult, fromCache } = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(fromCache).toBe(true);
    expect(scanResult).toEqual({ ...cachedResult, imageDigest: 'sha256:abc123' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('should run fresh scan when DB has been updated since cache', async () => {
    const cachedResult = createMockScanResult();
    updateDigestScanCache('sha256:abc123', cachedResult, '2025-01-01T00:00:00Z');

    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const { scanResult, fromCache } = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2025-02-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(fromCache).toBe(false);
    expect(scanResult.status).toBe('passed');
  });

  test('should run fresh scan when trivyDbUpdatedAt is not provided', async () => {
    const cachedResult = createMockScanResult();
    updateDigestScanCache('sha256:abc123', cachedResult, '2025-01-01T00:00:00Z');

    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const { scanResult, fromCache } = await scanImageWithDedup(
      { image: 'registry.example.com/app:1.2.3', digest: 'sha256:abc123' },
      3_600_000,
    );

    expect(fromCache).toBe(false);
    expect(scanResult.status).toBe('passed');
  });

  test('should run fresh scan when cache entry has expired', async () => {
    const cachedResult = createMockScanResult();
    updateDigestScanCache('sha256:abc123', cachedResult, '2025-01-01T00:00:00Z');

    // Use a tiny interval so the cache entry appears expired immediately
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const { fromCache } = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      0,
    );

    expect(fromCache).toBe(false);
  });

  test('should populate cache after a fresh scan', async () => {
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    expect(getDigestScanCacheSize()).toBe(0);

    await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(getDigestScanCacheSize()).toBe(1);
  });

  test('should NOT re-scan within the error retry floor when a prior scan errored (issue #357)', async () => {
    let invocations = 0;
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      invocations += 1;
      callback(new Error('trivy boom'), '', 'dial unix /var/run/docker.sock: ENOENT');
      return { exitCode: 1 };
    };

    expect(getDigestScanCacheSize()).toBe(0);

    const first = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(first.scanResult.status).toBe('error');
    expect(getDigestScanCacheSize()).toBe(0);

    // Second call within the floor window — Trivy should NOT be invoked again.
    const second = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    // Returns the same error result from the floor cache, not a fresh scan.
    expect(second.fromCache).toBe(true);
    expect(second.scanResult.status).toBe('error');
    expect(invocations).toBe(1);
  });

  test('should re-scan after error retry floor expires (issue #357)', async () => {
    let invocations = 0;
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      invocations += 1;
      if (invocations === 1) {
        callback(new Error('trivy boom'), '', 'dial unix /var/run/docker.sock: ENOENT');
        return { exitCode: 1 };
      }
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    vi.useFakeTimers();

    await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient-expire',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );
    expect(invocations).toBe(1);

    // Advance past the 15-minute error retry floor
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    const result = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient-expire',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );

    vi.useRealTimers();

    expect(result.fromCache).toBe(false);
    expect(invocations).toBe(2);
  });

  test('should cache success after a prior error on the same digest (issue #357)', async () => {
    let invocations = 0;
    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      invocations += 1;
      if (invocations === 1) {
        callback(new Error('trivy boom'), '', 'dial unix /var/run/docker.sock: ENOENT');
        return { exitCode: 1 };
      }
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    // First call — error
    await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient2',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );
    expect(invocations).toBe(1);
    expect(getDigestScanCacheSize()).toBe(0);

    // Reset the floor so the second call can proceed
    _resetErrorRetryFloorForTesting();

    // Second call — succeeds
    const second = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient2',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );
    expect(invocations).toBe(2);
    expect(second.scanResult.status).toBe('passed');
    expect(getDigestScanCacheSize()).toBe(1);

    // Third call — should come from success cache
    const execFileMockThird = vi.fn();
    childProcessControl.execFileImpl = execFileMockThird;
    const third = await scanImageWithDedup(
      {
        image: 'registry.example.com/app:1.2.3',
        digest: 'sha256:transient2',
        trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
      },
      3_600_000,
    );
    expect(third.fromCache).toBe(true);
    expect(third.scanResult.status).toBe('passed');
    expect(execFileMockThird).not.toHaveBeenCalled();
  });

  test('does not cache a blocked partial result that still contains a provider error', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'both',
    });
    let invocations = 0;
    childProcessControl.execFileImpl = (command, _args, _options, callback) => {
      invocations += 1;
      if (command === 'trivy') {
        callback(
          null,
          JSON.stringify({
            Results: [
              {
                Vulnerabilities: [{ VulnerabilityID: 'CVE-BLOCK', Severity: 'CRITICAL' }],
              },
            ],
          }),
          '',
        );
        return { exitCode: 0 };
      }
      callback(Object.assign(new Error('failed'), { code: '1' }), '', 'database unavailable');
      return { exitCode: 1 };
    };

    const options = {
      image: 'registry.example.com/app:1.2.3',
      digest: 'sha256:partial-block',
      trivyDbUpdatedAt: '2025-01-01T00:00:00Z',
    };
    const first = await scanImageWithDedup(options, 3_600_000);
    const second = await scanImageWithDedup(options, 3_600_000);

    expect(first).toMatchObject({
      fromCache: false,
      scanResult: { status: 'blocked', error: expect.stringContaining('Grype') },
    });
    expect(second.fromCache).toBe(false);
    expect(invocations).toBe(4);
    expect(getDigestScanCacheSize()).toBe(0);
  });
});

describe('clearDigestScanCache', () => {
  test('should clear all entries from the cache', () => {
    const mockResult = createMockScanResult();
    updateDigestScanCache('sha256:aaa', mockResult, '2025-01-01T00:00:00Z');
    updateDigestScanCache('sha256:bbb', mockResult, '2025-01-01T00:00:00Z');

    expect(getDigestScanCacheSize()).toBe(2);

    clearDigestScanCache();

    expect(getDigestScanCacheSize()).toBe(0);
  });
});

describe('updateDigestScanCache', () => {
  test('should evict oldest entries when cache size cap is exceeded', async () => {
    const cachedResult = createMockScanResult('registry.example.com/evict:test');
    for (let index = 0; index <= DIGEST_SCAN_CACHE_MAX_ENTRIES; index += 1) {
      updateDigestScanCache(`sha256:${index}`, cachedResult, '2025-03-01T00:00:00Z');
    }

    expect(getDigestScanCacheSize()).toBe(DIGEST_SCAN_CACHE_MAX_ENTRIES);

    childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ Results: [] }), '');
      return { exitCode: 0 };
    };

    const oldestDigestResult = await scanImageWithDedup(
      {
        image: 'registry.example.com/evict:test',
        digest: 'sha256:0',
        trivyDbUpdatedAt: '2025-03-01T00:00:00Z',
      },
      3_600_000,
    );
    const newestDigestResult = await scanImageWithDedup(
      {
        image: 'registry.example.com/evict:test',
        digest: `sha256:${DIGEST_SCAN_CACHE_MAX_ENTRIES}`,
        trivyDbUpdatedAt: '2025-03-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(oldestDigestResult.fromCache).toBe(false);
    expect(newestDigestResult.fromCache).toBe(true);
  });

  test('should manually populate cache so scanImageWithDedup uses it', async () => {
    const cachedResult = createMockScanResult('manual-image:latest');
    updateDigestScanCache('sha256:manual', cachedResult, '2025-03-01T00:00:00Z');

    const execFileMock = vi.fn();
    childProcessControl.execFileImpl = execFileMock;

    const { scanResult, fromCache } = await scanImageWithDedup(
      {
        image: 'manual-image:latest',
        digest: 'sha256:manual',
        trivyDbUpdatedAt: '2025-03-01T00:00:00Z',
      },
      3_600_000,
    );

    expect(fromCache).toBe(true);
    expect(scanResult).toEqual({ ...cachedResult, imageDigest: 'sha256:manual' });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
