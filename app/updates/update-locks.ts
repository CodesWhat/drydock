import { LockManager } from './locks.js';

export interface ContainerLockReference {
  name: string;
  watcher: string;
}

const updateLockManager = new LockManager();

export function withContainerUpdateLocks<T>(
  keys: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  return updateLockManager.withLocks(keys, fn);
}

export function buildContainerLockKey(container: ContainerLockReference): string {
  return `container:${container.watcher}:${container.name}`;
}

export function buildComposeProjectLockKey(
  container: ContainerLockReference,
  composeProject: string,
): string {
  return `compose:${container.watcher}:${composeProject}`;
}

export function getUpdateLockSnapshot(): {
  held: string[];
  pending: Array<{ key: string; waiters: number }>;
} {
  return {
    held: updateLockManager.held(),
    pending: updateLockManager.pending(),
  };
}
