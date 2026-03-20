import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { emitContainerUpdateApplied, emitContainerUpdateFailed } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import * as backupStore from '../../../store/backup.js';
import { sleep } from '../../../util/sleep.js';
import Dockercompose, {
  testable_hasExplicitRegistryHost,
  testable_normalizeImplicitLatest,
  testable_normalizePostStartEnvironmentValue,
  testable_normalizePostStartHooks,
  testable_updateComposeServiceImageInText,
} from './Dockercompose.js';
import {
  makeCompose,
  makeContainer,
  makeDockerContainerHandle,
  makeExecMocks,
  setupDockercomposeTestContext,
  spyOnProcessComposeHelpers,
} from './Dockercompose.test.helpers.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSelfUpdateStarting: vi.fn(),
}));

vi.mock('../../../model/container.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fullName: vi.fn((c) => `test_${c.name}`),
  };
});

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
}));

// Modules used by the shared lifecycle (inherited from Docker trigger)
vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual('../../../configuration/index.js');
  return { ...actual, getSecurityConfiguration: vi.fn().mockReturnValue({ enabled: false }) };
});
vi.mock('../../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: vi.fn().mockReturnValue(null) }));
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: vi.fn(),
  verifyImageSignature: vi.fn(),
  generateImageSbom: vi.fn(),
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock('../../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      access: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('Dockercompose Trigger', () => {
  let trigger;
  let mockLog;
  let mockDockerApi;

  beforeEach(() => {
    ({ trigger, mockLog, mockDockerApi } = setupDockercomposeTestContext({
      DockercomposeCtor: Dockercompose,
      watchMock: watch,
      getStateMock: getState,
    }));
  });

  // File operations & misc
  // -----------------------------------------------------------------------

  test('backup should log warning on error', async () => {
    fs.copyFile.mockRejectedValueOnce(new Error('copy failed'));

    await trigger.backup('/opt/drydock/test/compose.yml', '/opt/drydock/test/compose.yml.back');

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('copy failed'));
  });

  test('writeComposeFile should log error and throw on write failure', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('write failed'));

    await expect(trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data')).rejects.toThrow(
      'write failed',
    );

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
  });

  test('writeComposeFile should stringify non-object write failures in logs', async () => {
    fs.writeFile.mockRejectedValueOnce(42);

    await expect(trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data')).rejects.toBe(
      42,
    );

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('(42)'));
  });

  test('writeComposeFile should write atomically through temp file + rename under lock', async () => {
    await trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data');

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml.drydock.lock',
      expect.any(String),
      { flag: 'wx' },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      'data',
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      '/opt/drydock/test/compose.yml',
    );
    expect(fs.unlink).toHaveBeenCalledWith('/opt/drydock/test/compose.yml.drydock.lock');
  });

  test('writeComposeFileAtomic should remove temp file and rethrow when rename fails', async () => {
    const renameError = new Error('rename failed');
    fs.rename.mockRejectedValueOnce(renameError);

    await expect(
      trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data'),
    ).rejects.toThrow('rename failed');

    const temporaryFilePath = fs.writeFile.mock.calls[0][0];
    expect(temporaryFilePath).toEqual(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
    );
    expect(fs.rename).toHaveBeenCalledWith(temporaryFilePath, '/opt/drydock/test/compose.yml');
    expect(fs.unlink).toHaveBeenCalledWith(temporaryFilePath);
  });

  test('writeComposeFileAtomic should retry on EBUSY and succeed', async () => {
    const ebusyError: any = new Error('EBUSY: resource busy or locked');
    ebusyError.code = 'EBUSY';
    fs.rename
      .mockRejectedValueOnce(ebusyError)
      .mockRejectedValueOnce(ebusyError)
      .mockResolvedValueOnce(undefined);

    await trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data');

    expect(fs.rename).toHaveBeenCalledTimes(3);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  test('writeComposeFileAtomic should fall back to direct write after EBUSY retries exhausted', async () => {
    const ebusyError: any = new Error('EBUSY: resource busy or locked');
    ebusyError.code = 'EBUSY';
    for (let i = 0; i < 6; i++) {
      fs.rename.mockRejectedValueOnce(ebusyError);
    }

    await trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data');

    // 1 initial attempt + 5 retries = 6 rename attempts
    expect(fs.rename).toHaveBeenCalledTimes(6);
    // Falls back to direct write to the target file
    expect(fs.writeFile).toHaveBeenCalledWith('/opt/drydock/test/compose.yml', 'data');
    // Temp file cleaned up
    const temporaryFilePath = fs.writeFile.mock.calls[0][0];
    expect(fs.unlink).toHaveBeenCalledWith(temporaryFilePath);
  });

  test('writeComposeFileAtomic should not retry on non-EBUSY errors', async () => {
    const permError: any = new Error('EACCES: permission denied');
    permError.code = 'EACCES';
    fs.rename.mockRejectedValueOnce(permError);

    await expect(
      trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data'),
    ).rejects.toThrow('EACCES');

    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  test('writeComposeFileAtomic should not retry when rename error code is non-string', async () => {
    const malformedCodeError: any = new Error('rename failed');
    malformedCodeError.code = 123;
    fs.rename.mockRejectedValueOnce(malformedCodeError);

    await expect(
      trigger.writeComposeFileAtomic('/opt/drydock/test/compose.yml', 'data'),
    ).rejects.toThrow('rename failed');

    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  test('withComposeFileLock should wait and retry when lock exists but is not stale', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile.mockRejectedValueOnce(lockBusyError).mockResolvedValueOnce(undefined);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: Date.now(),
    });
    const waitForLockChangeSpy = vi
      .spyOn(trigger._composeFileLockManager, 'waitForComposeFileLockChange')
      .mockResolvedValueOnce(true);
    const operation = vi.fn().mockResolvedValue('ok');

    const result = await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', operation);

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledWith('/opt/drydock/test/compose.yml');
    expect(waitForLockChangeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml.drydock.lock',
      expect.any(Number),
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  test('withComposeFileLock should time out while waiting for a busy lock', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile.mockRejectedValueOnce(lockBusyError);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: 0,
    });
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10_001);

    try {
      await expect(
        trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => 'never'),
      ).rejects.toThrow('Timed out waiting for compose file lock');
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test('withComposeFileLock should warn when lock removal fails with a non-ENOENT error', async () => {
    const lockRemovalError: any = new Error('permission denied');
    lockRemovalError.code = 'EPERM';
    fs.unlink.mockRejectedValueOnce(lockRemovalError);

    await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => undefined);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not remove compose file lock'),
    );
  });

  test('withComposeFileLock should ignore ENOENT when lock removal races', async () => {
    const lockRemovalError: any = new Error('gone');
    lockRemovalError.code = 'ENOENT';
    fs.unlink.mockRejectedValueOnce(lockRemovalError);

    await trigger.withComposeFileLock('/opt/drydock/test/compose.yml', async () => undefined);

    expect(
      mockLog.warn.mock.calls.some(([message]) =>
        String(message).includes('Could not remove compose file lock'),
      ),
    ).toBe(false);
  });

  test('withComposeFileLock should execute immediately when lock is already held by this process', async () => {
    const filePath = '/opt/drydock/test/compose.yml';
    trigger._composeFileLocksHeld.add(filePath);
    const operation = vi.fn().mockResolvedValue('ok');

    try {
      const result = await trigger.withComposeFileLock(filePath, operation);
      expect(result).toBe('ok');
      expect(operation).toHaveBeenCalledWith(filePath);
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        `${filePath}.drydock.lock`,
        expect.any(String),
        { flag: 'wx' },
      );
    } finally {
      trigger._composeFileLocksHeld.delete(filePath);
    }
  });

  test('waitForComposeFileLockChange should return false when timeout is not positive', async () => {
    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 0),
    ).resolves.toBe(false);
  });

  test('waitForComposeFileLockChange should return false when timeout elapses without lock changes', async () => {
    vi.useFakeTimers();
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation(() => watcher);

    try {
      const waitForLockChange = trigger.waitForComposeFileLockChange(
        '/opt/drydock/test/compose.yml.drydock.lock',
        1_000,
      );

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(waitForLockChange).resolves.toBe(false);
      expect(watcher.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('waitForComposeFileLockChange should settle when changed path is unavailable', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => onChange('rename', null as any));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should settle when target lock file changes', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => onChange('change', Buffer.from('compose.yml.drydock.lock')));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should ignore duplicate settle attempts after it resolves', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation((_directoryPath, onChange: any) => {
      setImmediate(() => {
        onChange('rename', null as any);
        onChange('change', 'compose.yml.drydock.lock');
      });
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('waitForComposeFileLockChange should settle when watcher emits an error', async () => {
    const watcher: any = new EventEmitter();
    watcher.close = vi.fn();
    const watchMock = vi.mocked(watch);
    watchMock.mockImplementation(() => {
      setImmediate(() => watcher.emit('error', new Error('watch failed')));
      return watcher;
    });

    await expect(
      trigger.waitForComposeFileLockChange('/opt/drydock/test/compose.yml.drydock.lock', 1_000),
    ).resolves.toBe(true);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  test('maybeReleaseStaleComposeFileLock should treat missing lock file as released', async () => {
    const missingLockError: any = new Error('missing lock');
    missingLockError.code = 'ENOENT';
    fs.stat.mockRejectedValueOnce(missingLockError);

    await expect(
      trigger.maybeReleaseStaleComposeFileLock('/opt/drydock/test/compose.yml.drydock.lock'),
    ).resolves.toBe(true);
  });

  test('maybeReleaseStaleComposeFileLock should warn and return false on unexpected stat errors', async () => {
    const statError: any = new Error('permission denied');
    statError.code = 'EPERM';
    fs.stat.mockRejectedValueOnce(statError);

    await expect(
      trigger.maybeReleaseStaleComposeFileLock('/opt/drydock/test/compose.yml.drydock.lock'),
    ).resolves.toBe(false);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not inspect compose file lock'),
    );
  });

  test('writeComposeFile should preserve rename error when temp cleanup also fails', async () => {
    const renameError = new Error('rename failed');
    fs.rename.mockRejectedValueOnce(renameError);
    fs.unlink.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data')).rejects.toThrow(
      'rename failed',
    );
  });

  test('mutateComposeFile should return false when no text changes are applied', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    const changed = await trigger.mutateComposeFile(
      '/opt/drydock/test/compose.yml',
      (text) => text,
    );

    expect(changed).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('mutateComposeFile should validate candidate compose config before writing', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const validateSpy = vi
      .spyOn(trigger, 'validateComposeConfiguration')
      .mockResolvedValue(undefined);
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    const changed = await trigger.mutateComposeFile('/opt/drydock/test/compose.yml', (text) =>
      text.replace('nginx:1.0.0', 'nginx:1.1.0'),
    );

    expect(changed).toBe(true);
    expect(validateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
    );
    expect(writeSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
    );
  });

  test('mutateComposeFile should block writes when compose validation fails', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    vi.spyOn(trigger, 'validateComposeConfiguration').mockRejectedValue(
      new Error('compose config is invalid'),
    );
    const writeSpy = vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();

    await expect(
      trigger.mutateComposeFile('/opt/drydock/test/compose.yml', (text) =>
        text.replace('nginx:1.0.0', 'nginx:1.1.0'),
      ),
    ).rejects.toThrow('compose config is invalid');

    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('mutateComposeFile should forward a pre-parsed compose object to validation', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(
      Buffer.from('services:\n  nginx:\n    image: nginx:1.0.0\n'),
    );
    const validateSpy = vi
      .spyOn(trigger, 'validateComposeConfiguration')
      .mockResolvedValue(undefined);
    vi.spyOn(trigger, 'writeComposeFile').mockResolvedValue();
    const parsedComposeFileObject = makeCompose({ nginx: { image: 'nginx:1.1.0' } });

    const changed = await trigger.mutateComposeFile(
      '/opt/drydock/test/compose.yml',
      (text) => text.replace('nginx:1.0.0', 'nginx:1.1.0'),
      {
        parsedComposeFileObject,
      },
    );

    expect(changed).toBe(true);
    expect(validateSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/compose.yml',
      expect.stringContaining('nginx:1.1.0'),
      {
        parsedComposeFileObject,
      },
    );
  });

  test('validateComposeConfiguration should validate compose text in-process without shell commands', async () => {
    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/compose.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
    );
  });

  test('validateComposeConfiguration should validate updated file against full compose file chain', async () => {
    const getComposeFileAsObjectSpy = vi
      .spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValue(makeCompose({ base: { image: 'busybox:1.0.0' } }));

    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/stack.override.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
      },
    );

    expect(getComposeFileAsObjectSpy).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
  });

  test('validateComposeConfiguration should reuse a pre-parsed compose object when provided', async () => {
    const parseSpy = vi.spyOn(yaml, 'parse');
    const getComposeFileAsObjectSpy = vi
      .spyOn(trigger, 'getComposeFileAsObject')
      .mockResolvedValue(makeCompose({ base: { image: 'busybox:1.0.0' } }));

    await trigger.validateComposeConfiguration(
      '/opt/drydock/test/stack.override.yml',
      'services:\n  nginx:\n    image: nginx:1.1.0\n',
      {
        composeFiles: ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
        parsedComposeFileObject: makeCompose({ nginx: { image: 'nginx:1.1.0' } }),
      },
    );

    expect(parseSpy).not.toHaveBeenCalled();
    expect(getComposeFileAsObjectSpy).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
  });

  test('updateComposeServiceImageInText should throw when compose document has parse errors', () => {
    expect(() =>
      testable_updateComposeServiceImageInText('services:\n  nginx: [\n', 'nginx', 'nginx:2.0.0'),
    ).toThrow();
  });

  test('updateComposeServiceImageInText should throw when service definition is not a map', () => {
    expect(() =>
      testable_updateComposeServiceImageInText(
        ['services:', '  nginx: "literal-service"', ''].join('\n'),
        'nginx',
        'nginx:2.0.0',
      ),
    ).toThrow('Unable to patch compose service nginx because it is not a map');
  });

  test('updateComposeServiceImageInText should append image line when service key has no trailing newline', () => {
    const updated = testable_updateComposeServiceImageInText(
      'services:\n  nginx:',
      'nginx',
      'nginx:2.0.0',
    );

    expect(updated).toBe('services:\n  nginx:\n    image: nginx:2.0.0');
  });

  test('writeComposeFile should remove stale lock and continue', async () => {
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    fs.writeFile
      .mockRejectedValueOnce(lockBusyError)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    fs.stat.mockResolvedValueOnce({
      mtimeMs: Date.now() - 200_000,
    });

    await trigger.writeComposeFile('/opt/drydock/test/compose.yml', 'data');

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Removed stale compose file lock'),
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/.compose.yml.tmp-'),
      '/opt/drydock/test/compose.yml',
    );
  });

  test('getComposeFileAsObject should throw on yaml parse error', async () => {
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from('invalid: yaml: [[['));

    await expect(trigger.getComposeFileAsObject('/opt/drydock/test/compose.yml')).rejects.toThrow();

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Error when parsing'));
  });

  test('getComposeFileAsObject should reuse cached parse when file mtime is unchanged', async () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const composeText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockResolvedValue(Buffer.from(composeText));
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat.mockResolvedValue({
      mtimeMs: 1700000000000,
    } as any);

    const first = await trigger.getComposeFileAsObject(composeFilePath);
    const second = await trigger.getComposeFileAsObject(composeFilePath);

    expect(first).toEqual(second);
    expect(getComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test('getComposeFileAsObject should evict least recently used cache entries when max size is reached', async () => {
    const composeFilePathA = '/opt/drydock/test/a.yml';
    const composeFilePathB = '/opt/drydock/test/b.yml';
    const composeFilePathC = '/opt/drydock/test/c.yml';
    trigger._composeCacheMaxEntries = 2;
    expect(trigger._composeCacheMaxEntries).toBe(2);

    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockImplementation(async (filePath) =>
        Buffer.from(
          ['services:', '  nginx:', `    image: ${path.basename(filePath, '.yml')}:1.0.0`, ''].join(
            '\n',
          ),
        ),
      );
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat.mockResolvedValue({
      mtimeMs: 1700000000000,
    } as any);

    await trigger.getComposeFileAsObject(composeFilePathA);
    await trigger.getComposeFileAsObject(composeFilePathB);
    await trigger.getComposeFileAsObject(composeFilePathA);
    await trigger.getComposeFileAsObject(composeFilePathC);

    expect(trigger._composeObjectCache.has(composeFilePathA)).toBe(true);
    expect(trigger._composeObjectCache.has(composeFilePathB)).toBe(false);
    expect(trigger._composeObjectCache.has(composeFilePathC)).toBe(true);

    await trigger.getComposeFileAsObject(composeFilePathB);

    expect(getComposeFileSpy).toHaveBeenCalledTimes(4);
    expect(parseSpy).toHaveBeenCalledTimes(4);
    expect(trigger._composeObjectCache.has(composeFilePathA)).toBe(false);
    expect(trigger._composeObjectCache.has(composeFilePathB)).toBe(true);
    expect(trigger._composeObjectCache.has(composeFilePathC)).toBe(true);
  });

  test('getCachedComposeDocument should reuse cached parse when file mtime is unchanged', () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');
    const firstText = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const secondText = ['services:', '  nginx:', '    image: nginx:2.0.0', ''].join('\n');

    const firstDocument = trigger.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      firstText,
    );
    const secondDocument = trigger.getCachedComposeDocument(
      composeFilePath,
      1700000000000,
      secondText,
    );

    expect(secondDocument).toBe(firstDocument);
    expect(parseDocumentSpy).toHaveBeenCalledTimes(1);
  });

  test('getCachedComposeDocument should evict least recently used cache entries when max size is reached', () => {
    const composeFilePathA = '/opt/drydock/test/a.yml';
    const composeFilePathB = '/opt/drydock/test/b.yml';
    const composeFilePathC = '/opt/drydock/test/c.yml';
    trigger._composeCacheMaxEntries = 2;
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    const firstDocumentA = trigger.getCachedComposeDocument(
      composeFilePathA,
      1700000000000,
      ['services:', '  app-a:', '    image: app-a:1.0.0', ''].join('\n'),
    );
    const firstDocumentB = trigger.getCachedComposeDocument(
      composeFilePathB,
      1700000000000,
      ['services:', '  app-b:', '    image: app-b:1.0.0', ''].join('\n'),
    );
    const secondDocumentA = trigger.getCachedComposeDocument(
      composeFilePathA,
      1700000000000,
      ['services:', '  app-a:', '    image: app-a:2.0.0', ''].join('\n'),
    );
    trigger.getCachedComposeDocument(
      composeFilePathC,
      1700000000000,
      ['services:', '  app-c:', '    image: app-c:1.0.0', ''].join('\n'),
    );

    expect(secondDocumentA).toBe(firstDocumentA);
    expect(trigger._composeDocumentCache.has(composeFilePathA)).toBe(true);
    expect(trigger._composeDocumentCache.has(composeFilePathB)).toBe(false);
    expect(trigger._composeDocumentCache.has(composeFilePathC)).toBe(true);

    const secondDocumentB = trigger.getCachedComposeDocument(
      composeFilePathB,
      1700000000000,
      ['services:', '  app-b:', '    image: app-b:2.0.0', ''].join('\n'),
    );

    expect(secondDocumentB).not.toBe(firstDocumentB);
    expect(parseDocumentSpy).toHaveBeenCalledTimes(4);
    expect(trigger._composeDocumentCache.has(composeFilePathA)).toBe(false);
    expect(trigger._composeDocumentCache.has(composeFilePathB)).toBe(true);
    expect(trigger._composeDocumentCache.has(composeFilePathC)).toBe(true);
  });

  test('getComposeFileAsObject should refresh cached parse when file mtime changes', async () => {
    const composeFilePath = '/opt/drydock/test/compose.yml';
    const getComposeFileSpy = vi
      .spyOn(trigger, 'getComposeFile')
      .mockResolvedValueOnce(
        Buffer.from(['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n')),
      )
      .mockResolvedValueOnce(
        Buffer.from(['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n')),
      );
    const parseSpy = vi.spyOn(yaml, 'parse');
    fs.stat
      .mockResolvedValueOnce({
        mtimeMs: 1700000000000,
      } as any)
      .mockResolvedValueOnce({
        mtimeMs: 1700000001000,
      } as any);

    const first = await trigger.getComposeFileAsObject(composeFilePath);
    const second = await trigger.getComposeFileAsObject(composeFilePath);

    expect(first).not.toEqual(second);
    expect(getComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test('getComposeFileAsObject should log default file path when called without explicit file argument', async () => {
    trigger.configuration.file = '/opt/drydock/test/default-compose.yml';
    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from('invalid: yaml: [[['));

    await expect(trigger.getComposeFileAsObject()).rejects.toThrow();

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('/opt/drydock/test/default-compose.yml'),
    );
  });

  test('getComposeFile should use default configuration file when no argument', () => {
    trigger.configuration.file = '/opt/drydock/test/default-compose.yml';

    trigger.getComposeFile();

    expect(fs.readFile).toHaveBeenCalledWith('/opt/drydock/test/default-compose.yml');
  });

  test('getComposeFile should log error and throw when fs.readFile throws synchronously', () => {
    const readFileMock = fs.readFile;
    readFileMock.mockImplementationOnce(() => {
      throw new Error('sync read error');
    });
    trigger.configuration.file = '/opt/drydock/test/compose.yml';

    expect(() => trigger.getComposeFile('/opt/drydock/test/compose.yml')).toThrow(
      'sync read error',
    );
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('sync read error'));
  });

  // -----------------------------------------------------------------------
  // triggerBatch
  // -----------------------------------------------------------------------

  test('triggerBatch should skip containers not on local host', async () => {
    const container = { name: 'remote-container', watcher: 'remote' };

    getState.mockReturnValue({
      registry: {
        hub: { getImageFullName: (image, tag) => `${image.name}:${tag}` },
      },
      watcher: {
        'docker.remote': {
          dockerApi: {
            modem: { socketPath: '' },
          },
        },
      },
    });

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not running on local host'));
  });

  test('triggerBatch should skip containers with no compose file', async () => {
    trigger.configuration.file = undefined;
    const container = { name: 'no-compose', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No compose file found'));
  });

  test('triggerBatch should skip containers when compose file does not exist', async () => {
    trigger.configuration.file = '/nonexistent/compose.yml';
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    fs.access.mockRejectedValueOnce(err);

    const container = { name: 'test-container', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  test('triggerBatch should log permission denied when compose file has EACCES', async () => {
    trigger.configuration.file = '/restricted/compose.yml';
    const err = new Error('EACCES');
    err.code = 'EACCES';
    fs.access.mockRejectedValueOnce(err);

    const container = { name: 'test-container', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  test('triggerBatch should warn when container compose file does not match configured file', async () => {
    trigger.configuration.file = '/opt/drydock/configured.yml';
    fs.access.mockResolvedValue(undefined);

    const container = {
      name: 'mismatched',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/other.yml' },
    };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  test('triggerBatch should warn when no containers matched any compose file', async () => {
    trigger.configuration.file = undefined;

    const container = { name: 'orphan', watcher: 'local' };

    await trigger.triggerBatch([container]);

    expect(mockLog.warn).toHaveBeenCalledWith(
      'No containers matched any compose file for this trigger',
    );
  });

  test('triggerBatch should group containers by compose file and process each', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/a.yml' },
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/b.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(2);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/a.yml', [container1]);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/b.yml', [container2]);
  });

  test('triggerBatch should group multiple containers under the same compose file', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/shared.yml' },
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/shared.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/shared.yml', [
      container1,
      container2,
    ]);
  });

  test('triggerBatch should only access each compose file once across containers sharing the same compose chain', async () => {
    trigger.configuration.file = undefined;
    fs.access.mockResolvedValue(undefined);

    const sharedComposeLabels = {
      'com.docker.compose.project.config_files':
        '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
    };
    const container1 = {
      name: 'app1',
      watcher: 'local',
      labels: sharedComposeLabels,
    };
    const container2 = {
      name: 'app2',
      watcher: 'local',
      labels: sharedComposeLabels,
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container1, container2]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(fs.access).toHaveBeenCalledTimes(2);
    expect(fs.access).toHaveBeenCalledWith('/opt/drydock/test/stack.yml');
    expect(fs.access).toHaveBeenCalledWith('/opt/drydock/test/stack.override.yml');
  });

  test('triggerBatch should only process containers matching configured compose file affinity', async () => {
    trigger.configuration.file = '/opt/drydock/test/monitoring.yml';
    fs.access.mockImplementation(async (composeFilePath) => {
      if (`${composeFilePath}`.includes('/opt/drydock/test/mysql.yml')) {
        const missingComposeError = new Error('ENOENT');
        missingComposeError.code = 'ENOENT';
        throw missingComposeError;
      }
      return undefined;
    });

    const monitoringContainer = {
      name: 'monitoring-app',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/monitoring.yml' },
    };
    const mysqlContainer = {
      name: 'mysql-app',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/test/mysql.yml' },
    };

    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([monitoringContainer, mysqlContainer]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith('/opt/drydock/test/monitoring.yml', [
      monitoringContainer,
    ]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  test('triggerBatch should resolve a configured compose directory to compose.yaml for affinity matching', async () => {
    trigger.configuration.file = '/opt/drydock/stacks/filebrowser';
    fs.stat.mockImplementation(async (candidatePath: string) => {
      if (candidatePath === '/opt/drydock/stacks/filebrowser') {
        return {
          isDirectory: () => true,
          mtimeMs: 1_700_000_000_000,
        } as any;
      }
      return {
        isDirectory: () => false,
        mtimeMs: 1_700_000_000_000,
      } as any;
    });
    fs.access.mockResolvedValue(undefined);

    const container = {
      name: 'filebrowser',
      watcher: 'local',
      labels: { 'dd.compose.file': '/opt/drydock/stacks/filebrowser/compose.yaml' },
    };
    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue(true);

    await trigger.triggerBatch([container]);

    expect(processComposeFileSpy).toHaveBeenCalledTimes(1);
    expect(processComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/stacks/filebrowser/compose.yaml',
      [container],
    );
    expect(mockLog.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('do not match configured file'),
    );
  });

  // -----------------------------------------------------------------------
});
