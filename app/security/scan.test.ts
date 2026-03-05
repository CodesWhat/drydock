import { vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());

const mockHasValidCommandPath = vi.hoisted(() => vi.fn());

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
  _resetTrivyQueueForTesting,
  _setTrivyQueueRejectedForTesting,
  clearDigestScanCache,
  DIGEST_SCAN_CACHE_MAX_ENTRIES,
  generateImageSbom,
  getDigestScanCacheSize,
  scanImageForVulnerabilities,
  scanImageWithDedup,
  updateDigestScanCache,
  verifyImageSignature,
} from './scan.js';

function createEnabledConfiguration() {
  return {
    enabled: true,
    scanner: 'trivy',
    blockSeverities: ['CRITICAL', 'HIGH'],
    trivy: {
      server: '',
      command: 'trivy',
      timeout: 120000,
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
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  childProcessControl.execFileImpl = null;
  _resetTrivyQueueForTesting();
  clearDigestScanCache();
  mockHasValidCommandPath.mockReturnValue(true);
  mockGetSecurityConfiguration.mockReturnValue(createEnabledConfiguration());
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
    expect(scanResult).toBe(cachedResult);
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
    expect(scanResult).toBe(cachedResult);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
