import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockWarn = vi.hoisted(() => vi.fn());
const mockRecordLegacyInput = vi.hoisted(() => vi.fn());

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../prometheus/compatibility.js', () => ({
  recordLegacyInput: (...args: unknown[]) => mockRecordLegacyInput(...args),
}));

import {
  _resetBundledTrivyNoticeForTesting,
  buildTrivyWorkerDeniedError,
  isBundledTrivyMigration,
  isCommandOnPath,
  isDockerAccessDenied,
  noteBundledTrivyRemoval,
  resolveProviderExecution,
} from './backend-resolution.js';

let binDirectory: string;

function installExecutable(name: string, mode = 0o755) {
  const file = path.join(binDirectory, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode });
  fs.chmodSync(file, mode);
  return file;
}

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    backend: 'auto',
    trivy: { command: 'trivy', commandExplicit: false },
    grype: { command: 'grype', commandExplicit: false },
    syft: { command: 'syft', commandExplicit: false },
    signature: { cosign: { command: 'cosign', commandExplicit: false } },
    ...overrides,
  };
}

beforeEach(() => {
  binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-backend-resolution-'));
  vi.stubEnv('PATH', binDirectory);
  mockWarn.mockReset();
  mockRecordLegacyInput.mockReset();
  _resetBundledTrivyNoticeForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(binDirectory, { recursive: true, force: true });
});

describe('isCommandOnPath', () => {
  test('finds an executable on PATH', () => {
    installExecutable('grype');
    expect(isCommandOnPath('grype')).toBe(true);
  });

  test('ignores a missing command', () => {
    expect(isCommandOnPath('grype')).toBe(false);
  });

  test('ignores a non-executable file and a directory with the same name', () => {
    installExecutable('grype', 0o644);
    fs.mkdirSync(path.join(binDirectory, 'syft'));
    expect(isCommandOnPath('grype')).toBe(false);
    expect(isCommandOnPath('syft')).toBe(false);
  });

  test('checks an absolute path directly', () => {
    const file = installExecutable('grype');
    expect(isCommandOnPath(file)).toBe(true);
    expect(isCommandOnPath(path.join(binDirectory, 'missing'))).toBe(false);
  });

  test('rejects relative paths and invalid command text', () => {
    installExecutable('grype');
    expect(isCommandOnPath('./grype')).toBe(false);
    expect(isCommandOnPath('grype --version')).toBe(false);
    expect(isCommandOnPath('')).toBe(false);
  });

  test('skips empty PATH entries and handles an unset PATH', () => {
    installExecutable('grype');
    vi.stubEnv('PATH', `${path.delimiter}${binDirectory}`);
    expect(isCommandOnPath('grype')).toBe(true);
    vi.stubEnv('PATH', '');
    expect(isCommandOnPath('grype')).toBe(false);
  });

  test('uses the supplied environment when given', () => {
    installExecutable('grype');
    expect(isCommandOnPath('grype', { PATH: '' })).toBe(false);
    expect(isCommandOnPath('grype', {})).toBe(false);
  });
});

describe('resolveProviderExecution', () => {
  test('docker and remote always use the worker', () => {
    installExecutable('grype');
    expect(resolveProviderExecution('grype', configuration({ backend: 'docker' }))).toBe('worker');
    expect(resolveProviderExecution('trivy', configuration({ backend: 'remote' }))).toBe('worker');
    expect(resolveProviderExecution('cosign', configuration({ backend: 'docker' }))).toBe('worker');
  });

  test('an explicit cosign command wins over docker and remote backends', () => {
    const explicit = {
      signature: { cosign: { command: '/opt/cosign', commandExplicit: true } },
    };
    expect(
      resolveProviderExecution('cosign', configuration({ backend: 'docker', ...explicit })),
    ).toBe('command');
    expect(
      resolveProviderExecution('cosign', configuration({ backend: 'remote', ...explicit })),
    ).toBe('command');
    expect(
      resolveProviderExecution(
        'grype',
        configuration({
          backend: 'docker',
          grype: { command: '/opt/grype', commandExplicit: true },
        }),
      ),
    ).toBe('worker');
  });

  test('auto picks the command when the binary is on PATH', () => {
    installExecutable('grype');
    expect(resolveProviderExecution('grype', configuration())).toBe('command');
  });

  test('auto picks the worker when the binary is missing', () => {
    expect(resolveProviderExecution('grype', configuration())).toBe('worker');
    expect(resolveProviderExecution('syft', configuration())).toBe('worker');
    expect(resolveProviderExecution('cosign', configuration())).toBe('worker');
    expect(resolveProviderExecution('trivy', configuration())).toBe('worker');
  });

  test('auto honors an explicitly set command even when it does not resolve', () => {
    expect(
      resolveProviderExecution(
        'grype',
        configuration({ grype: { command: '/opt/grype', commandExplicit: true } }),
      ),
    ).toBe('command');
    expect(
      resolveProviderExecution(
        'cosign',
        configuration({ signature: { cosign: { command: '/opt/cosign', commandExplicit: true } } }),
      ),
    ).toBe('command');
  });

  test('auto resolves a configured command name against PATH', () => {
    installExecutable('my-grype');
    expect(
      resolveProviderExecution(
        'grype',
        configuration({ grype: { command: 'my-grype', commandExplicit: false } }),
      ),
    ).toBe('command');
  });

  test('explicit command stays on the command for grype, syft and cosign', () => {
    expect(resolveProviderExecution('grype', configuration({ backend: 'command' }))).toBe(
      'command',
    );
    expect(resolveProviderExecution('syft', configuration({ backend: 'command' }))).toBe('command');
    expect(resolveProviderExecution('cosign', configuration({ backend: 'command' }))).toBe(
      'command',
    );
  });

  test('explicit command routes Trivy to the worker only when no binary resolves', () => {
    expect(resolveProviderExecution('trivy', configuration({ backend: 'command' }))).toBe('worker');
    installExecutable('trivy');
    expect(resolveProviderExecution('trivy', configuration({ backend: 'command' }))).toBe(
      'command',
    );
  });

  test('explicit command with a user-mounted Trivy command keeps working unchanged', () => {
    expect(
      resolveProviderExecution(
        'trivy',
        configuration({
          backend: 'command',
          trivy: { command: '/mnt/trivy', commandExplicit: true },
        }),
      ),
    ).toBe('command');
  });

  test('missing provider settings fall back to default command names and auto', () => {
    expect(resolveProviderExecution('trivy', { backend: '' })).toBe('worker');
    installExecutable('cosign');
    expect(resolveProviderExecution('cosign', { backend: 'auto' })).toBe('command');
  });
});

describe('isBundledTrivyMigration', () => {
  test('true when Trivy routes to the worker under auto or command', () => {
    expect(isBundledTrivyMigration(configuration())).toBe(true);
    expect(isBundledTrivyMigration(configuration({ backend: 'command' }))).toBe(true);
  });

  test('treats a missing backend as auto', () => {
    expect(isBundledTrivyMigration({})).toBe(true);
  });

  test('false for docker, remote and resolvable binaries', () => {
    expect(isBundledTrivyMigration(configuration({ backend: 'docker' }))).toBe(false);
    expect(isBundledTrivyMigration(configuration({ backend: 'remote' }))).toBe(false);
    installExecutable('trivy');
    expect(isBundledTrivyMigration(configuration())).toBe(false);
  });
});

describe('noteBundledTrivyRemoval', () => {
  test('warns and counts once per process', () => {
    noteBundledTrivyRemoval();
    noteBundledTrivyRemoval();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const message = mockWarn.mock.calls[0][0] as string;
    expect(message).toContain('DD_SECURITY_SCANNER=grype');
    expect(message).toContain('DD_SECURITY_BACKEND=remote');
    expect(message).toContain('DD_SECURITY_TRIVY_COMMAND');
    expect(mockRecordLegacyInput).toHaveBeenCalledTimes(1);
    expect(mockRecordLegacyInput).toHaveBeenCalledWith('env', 'DD_SECURITY_SCANNER=trivy');
  });
});

describe('isDockerAccessDenied', () => {
  test('recognizes HTTP 403, EACCES and denial wording', () => {
    expect(isDockerAccessDenied({ statusCode: 403, message: 'x' })).toBe(true);
    expect(isDockerAccessDenied({ code: 'EACCES', message: 'x' })).toBe(true);
    expect(isDockerAccessDenied(new Error('request denied by proxy'))).toBe(true);
    expect(isDockerAccessDenied(new Error('403 Forbidden'))).toBe(true);
    expect(isDockerAccessDenied(new Error('operation not permitted'))).toBe(true);
  });

  test('ignores unrelated failures', () => {
    expect(isDockerAccessDenied(new Error('timeout'))).toBe(false);
    expect(isDockerAccessDenied({ statusCode: 500 })).toBe(false);
    expect(isDockerAccessDenied(undefined)).toBe(false);
    expect(isDockerAccessDenied('denied')).toBe(false);
  });
});

describe('buildTrivyWorkerDeniedError', () => {
  test('names the three working setups and keeps the cause', () => {
    const cause = new Error('(HTTP code 403) unexpected - Forbidden');
    const error = buildTrivyWorkerDeniedError(cause);
    expect(error.message).toContain('DD_SECURITY_SCANNER=grype');
    expect(error.message).toContain('DD_SECURITY_BACKEND=remote');
    expect(error.message).toContain('DD_SECURITY_TRIVY_SERVER');
    expect(error.message).toContain('DD_SECURITY_TRIVY_COMMAND');
    expect(error.message).toContain('Forbidden');
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });

  test('handles a non-error cause', () => {
    expect(buildTrivyWorkerDeniedError({ statusCode: 403 }).message).toContain('403');
    expect(buildTrivyWorkerDeniedError('denied').message).toContain('HTTP error');
  });
});
