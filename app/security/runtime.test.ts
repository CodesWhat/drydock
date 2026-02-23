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

import { getSecurityRuntimeStatus } from './runtime.js';

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
      enabled: false,
      formats: ['spdx-json'],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  childProcessControl.execFileImpl = null;
  mockGetSecurityConfiguration.mockReturnValue(createEnabledConfiguration());
});

test('getSecurityRuntimeStatus should report ready when trivy is available', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, 'version', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(status.ready).toBe(true);
  expect(status.scanner.status).toBe('ready');
  expect(status.scanner.commandAvailable).toBe(true);
  expect(status.signature.status).toBe('ready');
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    ['--version'],
    expect.objectContaining({ timeout: 4000 }),
    expect.any(Function),
  );
});

test('getSecurityRuntimeStatus should report missing trivy command', async () => {
  const execFileMock = vi.fn((command, _args, _options, callback) => {
    const error = new Error('missing binary') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    callback(error, '', '');
    return { exitCode: 1 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(status.ready).toBe(false);
  expect(status.scanner.status).toBe('missing');
  expect(status.scanner.commandAvailable).toBe(false);
  expect(status.requirements).toContain('Install trivy (configured command: "trivy")');
});

test('getSecurityRuntimeStatus should report disabled scanner when not configured', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    enabled: false,
    scanner: '',
  });

  const status = await getSecurityRuntimeStatus();

  expect(status.ready).toBe(false);
  expect(status.scanner.status).toBe('disabled');
  expect(status.scanner.commandAvailable).toBeNull();
  expect(status.scanner.message).toContain('disabled');
});

test('getSecurityRuntimeStatus should report missing cosign when signature verification is enabled', async () => {
  const execFileMock = vi.fn((command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(null, 'trivy 0.1.0', '');
      return { exitCode: 0 };
    }
    const error = new Error('missing cosign') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    callback(error, '', '');
    return { exitCode: 1 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(status.ready).toBe(true);
  expect(status.signature.status).toBe('missing');
  expect(status.signature.commandAvailable).toBe(false);
  expect(status.requirements).toContain('Install cosign (configured command: "cosign")');
});

test('getSecurityRuntimeStatus should treat non-zero exit as command available', async () => {
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    const error = new Error('unsupported version flag') as NodeJS.ErrnoException;
    error.code = '1';
    callback(error, '', 'unsupported flag');
    return { exitCode: 1 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(status.scanner.status).toBe('ready');
  expect(status.scanner.commandAvailable).toBe(true);
  expect(status.signature.status).toBe('ready');
});

test('getSecurityRuntimeStatus should include server mode message when trivy server is configured', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      server: 'http://trivy:4954',
    },
  });
  childProcessControl.execFileImpl = (_command, _args, _options, callback) => {
    callback(null, 'ok', '');
    return { exitCode: 0 };
  };

  const status = await getSecurityRuntimeStatus();

  expect(status.scanner.server).toBe('http://trivy:4954');
  expect(status.scanner.message).toContain('server mode');
});
