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

vi.mock('../log/index.js', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

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

import { scanImageForVulnerabilities } from './scan.js';

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
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  childProcessControl.execFileImpl = null;
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
    expect.arrayContaining([
      'image',
      '--format',
      'json',
      '--server',
      'http://trivy:4954',
    ]),
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
