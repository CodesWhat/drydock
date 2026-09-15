import fs from 'node:fs/promises';
import ComposeFileLockManager from './ComposeFileLockManager.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('ComposeFileLockManager', () => {
  test('withComposeFileLock should not reacquire lock when operation nests on the same file', async () => {
    const manager = new ComposeFileLockManager({
      getLog: () => ({ warn: vi.fn() }),
    });

    const nestedOperation = vi.fn(async () => 'ok');

    const result = await manager.withComposeFileLock('/opt/drydock/test/compose.yml', (filePath) =>
      manager.withComposeFileLock(filePath, nestedOperation),
    );

    expect(result).toBe('ok');
    expect(nestedOperation).toHaveBeenCalledWith('/opt/drydock/test/compose.yml');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  test('withComposeFileLock should queue across manager instances and avoid wait polling for local contention', async () => {
    const filePath = '/opt/drydock/test/compose.yml';
    const lockBusyError: any = new Error('lock exists');
    lockBusyError.code = 'EEXIST';
    const managerA = new ComposeFileLockManager({
      getLog: () => ({ warn: vi.fn() }),
    });
    const managerB = new ComposeFileLockManager({
      getLog: () => ({ warn: vi.fn() }),
    });
    let firstOperationActive = false;
    let markFirstOperationStarted: () => void = () => {};
    const firstOperationStarted = new Promise<void>((resolve) => {
      markFirstOperationStarted = resolve;
    });
    let releaseFirstOperation: () => void = () => {};
    const firstOperationDone = new Promise<void>((resolve) => {
      releaseFirstOperation = resolve;
    });
    let releaseWaitForLockChange: (value: boolean) => void = () => {};
    const waitForLockChangePromise = new Promise<boolean>((resolve) => {
      releaseWaitForLockChange = resolve;
    });
    let lockCreateAttemptCount = 0;
    let markSecondLockAttempted: () => void = () => {};
    const secondLockAttempted = new Promise<void>((resolve) => {
      markSecondLockAttempted = resolve;
    });

    fs.writeFile.mockImplementation(async (...args) => {
      if (args[2]?.flag === 'wx') {
        lockCreateAttemptCount++;
        if (firstOperationActive) {
          markSecondLockAttempted();
          throw lockBusyError;
        }
      }
      return undefined;
    });
    vi.spyOn(managerB, 'maybeReleaseStaleComposeFileLock').mockResolvedValue(false);
    const waitForLockChangeSpy = vi
      .spyOn(managerB, 'waitForComposeFileLockChange')
      .mockImplementation(async () => waitForLockChangePromise);

    const firstLockOperation = managerA.withComposeFileLock(filePath, async () => {
      firstOperationActive = true;
      markFirstOperationStarted();
      await firstOperationDone;
      firstOperationActive = false;
      return 'first';
    });

    await firstOperationStarted;
    expect(managerA._composeFileLocksHeld.has(filePath)).toBe(true);
    expect(managerB._composeFileLocksHeld.has(filePath)).toBe(false);

    const secondLockOperation = managerB.withComposeFileLock(filePath, async () => 'second');

    await Promise.race([secondLockAttempted, new Promise((resolve) => setTimeout(resolve, 5))]);

    const lockWaitCallCountBeforeRelease = waitForLockChangeSpy.mock.calls.length;
    const lockCreateAttemptCountBeforeRelease = lockCreateAttemptCount;
    releaseFirstOperation();
    releaseWaitForLockChange(true);
    const [firstResult, secondResult] = await Promise.all([
      firstLockOperation,
      secondLockOperation,
    ]);

    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
    expect(lockCreateAttemptCountBeforeRelease).toBe(1);
    expect(lockWaitCallCountBeforeRelease).toBe(0);
  });

  test('withComposeFileLock should release the lock when the operation throws, so a subsequent acquisition succeeds immediately', async () => {
    const filePath = '/opt/drydock/test/compose.yml';
    const lockFilePath = `${filePath}.drydock.lock`;
    let lockFileExists = false;

    fs.writeFile
      .mockReset()
      .mockImplementation(async (target: unknown, _data: unknown, opts?: { flag?: string }) => {
        if (opts?.flag === 'wx') {
          if (lockFileExists) {
            const lockBusyError: any = new Error('lock exists');
            lockBusyError.code = 'EEXIST';
            throw lockBusyError;
          }
          lockFileExists = true;
        }
        return undefined;
      });
    fs.unlink.mockReset().mockImplementation(async () => {
      lockFileExists = false;
    });

    const manager = new ComposeFileLockManager({ getLog: () => ({ warn: vi.fn() }) });
    const waitForLockChangeSpy = vi.spyOn(manager, 'waitForComposeFileLockChange');

    await expect(
      manager.withComposeFileLock(filePath, async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.unlink).toHaveBeenCalledWith(lockFilePath);
    expect(lockFileExists).toBe(false);

    const secondOperation = vi.fn(async () => 'second');
    const secondResult = await manager.withComposeFileLock(filePath, secondOperation);

    expect(secondResult).toBe('second');
    // If the release were skipped on throw (release moved out of `finally`),
    // the lock file would still be present and this second acquisition would
    // hit EEXIST and have to wait for it, instead of succeeding immediately.
    expect(waitForLockChangeSpy).not.toHaveBeenCalled();
  });

  test('withComposeFileLock should clear the held-lock fast-path entry when the operation throws', async () => {
    const filePath = '/opt/drydock/test/compose.yml';
    fs.writeFile.mockReset().mockResolvedValue(undefined);

    const manager = new ComposeFileLockManager({ getLog: () => ({ warn: vi.fn() }) });

    await expect(
      manager.withComposeFileLock(filePath, async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    expect(manager._composeFileLocksHeld.has(filePath)).toBe(false);

    const secondOperation = vi.fn(async () => 'second');
    const secondResult = await manager.withComposeFileLock(filePath, secondOperation);

    expect(secondResult).toBe('second');
    expect(secondOperation).toHaveBeenCalledWith(filePath);
    // If the held-set delete were removed, the entry would leak and the
    // second call would take the in-process fast path without reacquiring
    // the lock, so fs.writeFile would only have been called once (the first
    // acquisition) instead of twice.
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
