import fs from 'node:fs/promises';
import { ComposeFileLockManager } from './ComposeFileLockManager.js';

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
      log: {
        warn: vi.fn(),
      },
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
      log: {
        warn: vi.fn(),
      },
    });
    const managerB = new ComposeFileLockManager({
      log: {
        warn: vi.fn(),
      },
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
});
