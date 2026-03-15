import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfiguredPath } from '../../../runtime/paths.js';

const COMPOSE_FILE_LOCK_SUFFIX = '.drydock.lock';
const COMPOSE_FILE_LOCK_MAX_WAIT_MS = 10_000;
const COMPOSE_FILE_LOCK_STALE_MS = 120_000;

export interface ComposeFileLockManagerOptions {
  getLog?: () => { warn?: (message: string) => void } | undefined;
}

/**
 * Manages file-level locking for compose writes, including stale lock cleanup
 * and lock-file change notifications.
 */
export class ComposeFileLockManager {
  _composeFileLocksHeld = new Set<string>();
  private static readonly composeFileLockQueue = new Map<string, Promise<void>>();
  private readonly getLog?: () => { warn?: (message: string) => void } | undefined;

  constructor(options: ComposeFileLockManagerOptions = {}) {
    this.getLog = options.getLog;
  }

  private warn(message: string) {
    this.getLog?.()?.warn?.(message);
  }

  private resolveComposeFilePath(file: string) {
    return resolveConfiguredPath(file, {
      label: 'Compose file path',
    });
  }

  private queueComposeFileLockOperation(filePath: string) {
    const previouslyQueuedLockOperation =
      ComposeFileLockManager.composeFileLockQueue.get(filePath) || Promise.resolve();
    let releaseQueuedLockOperation!: () => void;
    const queuedLockOperation = new Promise<void>((resolve) => {
      releaseQueuedLockOperation = resolve;
    });
    ComposeFileLockManager.composeFileLockQueue.set(filePath, queuedLockOperation);
    return {
      previouslyQueuedLockOperation,
      queuedLockOperation,
      releaseQueuedLockOperation,
    };
  }

  private async waitForQueuedComposeFileLock(previouslyQueuedLockOperation: Promise<void>) {
    try {
      await previouslyQueuedLockOperation;
    } catch {
      // Ignore queue failures from previous operations and proceed with lock acquisition.
    }
  }

  private finalizeQueuedComposeFileLockOperation(
    filePath: string,
    queuedLockOperation: Promise<void>,
    releaseQueuedLockOperation: () => void,
  ) {
    releaseQueuedLockOperation();
    if (ComposeFileLockManager.composeFileLockQueue.get(filePath) === queuedLockOperation) {
      ComposeFileLockManager.composeFileLockQueue.delete(filePath);
    }
  }

  private async tryCreateComposeFileLock(lockFilePath: string) {
    await fs.writeFile(lockFilePath, `${process.pid}:${Date.now()}\n`, { flag: 'wx' });
  }

  private async acquireComposeFileLock(filePath: string) {
    const lockFilePath = `${filePath}${COMPOSE_FILE_LOCK_SUFFIX}`;
    const lockWaitDeadline = Date.now() + COMPOSE_FILE_LOCK_MAX_WAIT_MS;
    while (true) {
      try {
        await this.tryCreateComposeFileLock(lockFilePath);
        this._composeFileLocksHeld.add(filePath);
        return lockFilePath;
      } catch (e: any) {
        if (e?.code !== 'EEXIST') {
          throw e;
        }
        const staleLockReleased = await this.maybeReleaseStaleComposeFileLock(lockFilePath);
        if (staleLockReleased) {
          continue;
        }
        const remainingWaitMs = lockWaitDeadline - Date.now();
        if (remainingWaitMs <= 0) {
          throw new Error(`Timed out waiting for compose file lock ${lockFilePath}`);
        }
        await this.waitForComposeFileLockChange(lockFilePath, remainingWaitMs);
      }
    }
  }

  private async releaseComposeFileLock(filePath: string, lockFilePath: string) {
    this._composeFileLocksHeld.delete(filePath);
    try {
      await fs.unlink(lockFilePath);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        this.warn(`Could not remove compose file lock ${lockFilePath} (${e.message})`);
      }
    }
  }

  private async runOperationWithComposeFileLock(
    filePath: string,
    operation: (resolvedFilePath: string) => Promise<unknown>,
  ) {
    const lockFilePath = await this.acquireComposeFileLock(filePath);
    try {
      return await operation(filePath);
    } finally {
      await this.releaseComposeFileLock(filePath, lockFilePath);
    }
  }

  async maybeReleaseStaleComposeFileLock(lockFilePath: string) {
    try {
      const lockFileStats = await fs.stat(lockFilePath);
      const lockAgeMs = Date.now() - lockFileStats.mtimeMs;
      if (lockAgeMs <= COMPOSE_FILE_LOCK_STALE_MS) {
        return false;
      }
      await fs.unlink(lockFilePath);
      this.warn(`Removed stale compose file lock ${lockFilePath}`);
      return true;
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        return true;
      }
      this.warn(`Could not inspect compose file lock ${lockFilePath} (${e.message})`);
      return false;
    }
  }

  async waitForComposeFileLockChange(lockFilePath: string, timeoutMs: number) {
    if (timeoutMs <= 0) {
      return false;
    }
    const lockDirectoryPath = path.dirname(lockFilePath);
    const lockFileName = path.basename(lockFilePath);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        watcher?.close();
        resolve(result);
      };
      const timeoutHandle = setTimeout(() => settle(false), timeoutMs);
      let watcher;
      try {
        watcher = watch(lockDirectoryPath, (_eventType, changedPath) => {
          if (changedPath === null || changedPath === undefined) {
            settle(true);
            return;
          }
          const changedFileName = Buffer.isBuffer(changedPath)
            ? changedPath.toString()
            : changedPath;
          if (changedFileName === lockFileName) {
            settle(true);
          }
        });
        watcher.on('error', () => settle(true));
      } catch {
        // If watch setup fails, fall back to timeout-based waiting.
      }
    });
  }

  async withComposeFileLock(
    file: string,
    operation: (resolvedFilePath: string) => Promise<unknown>,
  ): Promise<unknown> {
    const filePath = this.resolveComposeFilePath(file);
    if (this._composeFileLocksHeld.has(filePath)) {
      return operation(filePath);
    }

    const { previouslyQueuedLockOperation, queuedLockOperation, releaseQueuedLockOperation } =
      this.queueComposeFileLockOperation(filePath);
    try {
      await this.waitForQueuedComposeFileLock(previouslyQueuedLockOperation);
      return await this.runOperationWithComposeFileLock(filePath, operation);
    } finally {
      this.finalizeQueuedComposeFileLockOperation(
        filePath,
        queuedLockOperation,
        releaseQueuedLockOperation,
      );
    }
  }
}

export default ComposeFileLockManager;
