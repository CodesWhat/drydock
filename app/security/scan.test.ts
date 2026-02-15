import { vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());

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

import { _resetTrivyQueueForTesting, generateImageSbom, scanImageForVulnerabilities, verifyImageSignature } from './scan.js';

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
  expect(result.documents['cyclonedx-json']).toEqual(expect.objectContaining({ bomFormat: 'cyclonedx' }));
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
