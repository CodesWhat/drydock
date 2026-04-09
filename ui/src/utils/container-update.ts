import { isNoUpdateAvailableError } from './error';

export type ContainerUpdateRequestResult = 'accepted' | 'stale';

export function createContainerUpdateBatchId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === 'function'
    ? randomUUID.call(globalThis.crypto)
    : `dd-update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isStaleContainerUpdateError(error: unknown): boolean {
  return isNoUpdateAvailableError(error);
}

export function getContainerUpdateStartedMessage(name: string): string {
  return `Update started: ${name}`;
}

export function getForceContainerUpdateStartedMessage(name: string): string {
  return `Force update started: ${name}`;
}

export function getContainerAlreadyUpToDateMessage(name: string): string {
  return `Already up to date: ${name}`;
}

export function formatContainerUpdateStartedCountMessage(count: number): string {
  return `Started update${count === 1 ? '' : 's'} for ${count} container${count === 1 ? '' : 's'}`;
}

export function formatContainersAlreadyUpToDateMessage(count: number): string {
  return `${count} container${count === 1 ? '' : 's'} already up to date`;
}

export async function runContainerUpdateRequest(args: {
  request: () => Promise<unknown>;
  onAccepted?: () => void | Promise<void>;
  onStale?: () => void | Promise<void>;
  isStaleError?: (error: unknown) => boolean;
}): Promise<ContainerUpdateRequestResult> {
  try {
    await args.request();
    await args.onAccepted?.();
    return 'accepted';
  } catch (error: unknown) {
    if (args.isStaleError?.(error) !== true) {
      throw error;
    }
    await args.onStale?.();
    return 'stale';
  }
}
