import type { ContainerLifecycleEventContext } from '../event/index.js';
import type { Container } from './container.js';

export interface InventoryRefreshOptions {
  operationId?: string;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

interface InventoryRefreshError {
  phase: 'store' | 'enumerate' | 'inspect' | 'labels' | 'image' | 'ownership' | 'stale' | 'persist';
  id?: string;
  message: string;
}

export interface InventoryRefreshResult {
  context: ContainerLifecycleEventContext;
  containers: Container[];
  removedIds: string[];
  errors: InventoryRefreshError[];
  authoritative: boolean;
}
