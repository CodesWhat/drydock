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

import {
  clearTrivyDatabaseStatusCache,
  getSecurityRuntimeStatus,
  getTrivyDatabaseStatus,
} from './runtime.js';

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
  clearTrivyDatabaseStatusCache();
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

test('getSecurityRuntimeStatus should reject relative scanner command paths', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      command: '../bin/trivy',
    },
    signature: {
      ...createEnabledConfiguration().signature,
      verify: false,
    },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, 'ok', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(execFileMock).not.toHaveBeenCalled();
  expect(status.ready).toBe(false);
  expect(status.scanner.status).toBe('missing');
  expect(status.scanner.commandAvailable).toBe(false);
  expect(status.scanner.message).toContain('invalid');
});

test('getSecurityRuntimeStatus should reject scanner commands with shell metacharacters', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    trivy: {
      ...createEnabledConfiguration().trivy,
      command: 'trivy;echo',
    },
    signature: {
      ...createEnabledConfiguration().signature,
      verify: false,
    },
  });
  const execFileMock = vi.fn((_command, _args, _options, callback) => {
    callback(null, 'ok', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(execFileMock).not.toHaveBeenCalled();
  expect(status.ready).toBe(false);
  expect(status.scanner.status).toBe('missing');
  expect(status.scanner.commandAvailable).toBe(false);
  expect(status.scanner.message).toContain('invalid');
});

test('getSecurityRuntimeStatus should reject signature commands with shell metacharacters', async () => {
  mockGetSecurityConfiguration.mockReturnValue({
    ...createEnabledConfiguration(),
    signature: {
      ...createEnabledConfiguration().signature,
      verify: true,
      cosign: {
        ...createEnabledConfiguration().signature.cosign,
        command: 'co$sign|cat',
      },
    },
  });
  const execFileMock = vi.fn((command, _args, _options, callback) => {
    if (command === 'trivy') {
      callback(null, 'ok', '');
      return { exitCode: 0 };
    }
    callback(null, 'ok', '');
    return { exitCode: 0 };
  });
  childProcessControl.execFileImpl = execFileMock;

  const status = await getSecurityRuntimeStatus();

  expect(execFileMock).toHaveBeenCalledTimes(1);
  expect(execFileMock).toHaveBeenCalledWith(
    'trivy',
    ['--version'],
    expect.objectContaining({ timeout: 4000 }),
    expect.any(Function),
  );
  expect(status.signature.status).toBe('missing');
  expect(status.signature.commandAvailable).toBe(false);
  expect(status.signature.message).toContain('invalid');
});

describe('getTrivyDatabaseStatus', () => {
  const validTrivyVersionOutput = JSON.stringify({
    Version: '0.50.0',
    VulnerabilityDB: {
      UpdatedAt: '2025-06-01T00:00:00Z',
      DownloadedAt: '2025-06-02T12:00:00Z',
    },
  });

  function mockExecFileSuccess(stdout: string) {
    const mock = vi.fn(
      (_command: unknown, _args: unknown, _options: unknown, callback: Function) => {
        callback(null, stdout, '');
        return { exitCode: 0 };
      },
    );
    childProcessControl.execFileImpl = mock;
    return mock;
  }

  function mockExecFileError() {
    const mock = vi.fn(
      (_command: unknown, _args: unknown, _options: unknown, callback: Function) => {
        const error = new Error('command failed') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        callback(error, '', '');
        return { exitCode: 1 };
      },
    );
    childProcessControl.execFileImpl = mock;
    return mock;
  }

  test('should return TrivyDatabaseStatus when execFile returns valid JSON', async () => {
    const execFileMock = mockExecFileSuccess(validTrivyVersionOutput);

    const result = await getTrivyDatabaseStatus();

    expect(result).toEqual({
      updatedAt: '2025-06-01T00:00:00Z',
      downloadedAt: '2025-06-02T12:00:00Z',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'trivy',
      ['version', '--format', 'json'],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 512 * 1024 }),
      expect.any(Function),
    );
  });

  test('should return cached result on second call without invoking execFile again', async () => {
    const execFileMock = mockExecFileSuccess(validTrivyVersionOutput);

    const first = await getTrivyDatabaseStatus();
    const second = await getTrivyDatabaseStatus();

    expect(first).toEqual(second);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  test('should deduplicate concurrent status lookups while request is in flight', async () => {
    const execFileMock = vi.fn(
      (_command: unknown, _args: unknown, _options: unknown, callback: Function) => {
        setTimeout(() => {
          callback(null, validTrivyVersionOutput, '');
        }, 5);
        return { exitCode: 0 };
      },
    );
    childProcessControl.execFileImpl = execFileMock;

    const [first, second] = await Promise.all([getTrivyDatabaseStatus(), getTrivyDatabaseStatus()]);

    expect(first).toEqual({
      updatedAt: '2025-06-01T00:00:00Z',
      downloadedAt: '2025-06-02T12:00:00Z',
    });
    expect(second).toEqual(first);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  test('should invoke execFile again after cache is cleared', async () => {
    const execFileMock = mockExecFileSuccess(validTrivyVersionOutput);

    await getTrivyDatabaseStatus();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    clearTrivyDatabaseStatusCache();

    await getTrivyDatabaseStatus();
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  test('should return undefined when execFile errors', async () => {
    mockExecFileError();

    const result = await getTrivyDatabaseStatus();

    expect(result).toBeUndefined();
  });

  test('should return undefined when execFile returns non-JSON output', async () => {
    mockExecFileSuccess('this is not json');

    const result = await getTrivyDatabaseStatus();

    expect(result).toBeUndefined();
  });

  test('should return undefined when JSON lacks VulnerabilityDB key', async () => {
    mockExecFileSuccess(JSON.stringify({ Version: '0.50.0' }));

    const result = await getTrivyDatabaseStatus();

    expect(result).toBeUndefined();
  });

  test('should return undefined when UpdatedAt is an empty string', async () => {
    mockExecFileSuccess(
      JSON.stringify({
        VulnerabilityDB: { UpdatedAt: '', DownloadedAt: '2025-06-02T12:00:00Z' },
      }),
    );

    const result = await getTrivyDatabaseStatus();

    expect(result).toBeUndefined();
  });

  test('should return undefined when UpdatedAt is not a string', async () => {
    mockExecFileSuccess(
      JSON.stringify({
        VulnerabilityDB: { UpdatedAt: 12345, DownloadedAt: '2025-06-02T12:00:00Z' },
      }),
    );

    const result = await getTrivyDatabaseStatus();

    expect(result).toBeUndefined();
  });

  test('should include downloadedAt when present as a string', async () => {
    mockExecFileSuccess(
      JSON.stringify({
        VulnerabilityDB: {
          UpdatedAt: '2025-06-01T00:00:00Z',
          DownloadedAt: '2025-06-02T12:00:00Z',
        },
      }),
    );

    const result = await getTrivyDatabaseStatus();

    expect(result).toEqual({
      updatedAt: '2025-06-01T00:00:00Z',
      downloadedAt: '2025-06-02T12:00:00Z',
    });
  });

  test('should exclude downloadedAt when it is not a string', async () => {
    mockExecFileSuccess(
      JSON.stringify({
        VulnerabilityDB: {
          UpdatedAt: '2025-06-01T00:00:00Z',
          DownloadedAt: 999,
        },
      }),
    );

    const result = await getTrivyDatabaseStatus();

    expect(result).toEqual({
      updatedAt: '2025-06-01T00:00:00Z',
      downloadedAt: undefined,
    });
  });

  test('should use fallback trivy command when config command is empty', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      trivy: { ...createEnabledConfiguration().trivy, command: '' },
    });
    const execFileMock = mockExecFileSuccess(validTrivyVersionOutput);

    await getTrivyDatabaseStatus();

    expect(execFileMock).toHaveBeenCalledWith(
      'trivy',
      ['version', '--format', 'json'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('should make a fresh execFile call after cache TTL expires', async () => {
    const execFileMock = mockExecFileSuccess(validTrivyVersionOutput);

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // first call — cache miss
      .mockReturnValueOnce(1000 + 5 * 60 * 1000 + 1); // second call — past TTL

    await getTrivyDatabaseStatus();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    await getTrivyDatabaseStatus();
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
