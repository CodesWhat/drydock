import { extractCollectionData, readJsonResponse } from '../utils/api';
import { ApiError } from '../utils/error';

interface WatcherDetailPathOptions {
  type: string;
  name: string;
  agent?: string;
}

export interface FleetWatcher extends WatcherDetailPathOptions {
  id: string;
  metadata?: {
    inventoryRefreshSupported?: boolean;
    containers?: { total: number; running: number; stopped: number };
  };
}

export interface InventoryRefreshResult {
  context: {
    origin: 'inventory';
    operationId: string;
    source: WatcherDetailPathOptions;
  };
  containers: unknown[];
  removedIds: string[];
  errors: { phase: string; id?: string; message: string }[];
  authoritative: boolean;
}

export async function refreshWatcherInventory(
  watcher: WatcherDetailPathOptions,
): Promise<InventoryRefreshResult> {
  const response = await fetch(`${buildWatcherDetailPath(watcher)}/inventory`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    throw new ApiError(`Inventory refresh failed: ${response.statusText}`, response.status);
  }
  return readJsonResponse(response);
}

function getWatcherProviderIcon(type: string) {
  if (type === 'docker') {
    return 'sh-docker';
  }
  return 'sh-eye';
}

function getWatcherProviderColor(type: string) {
  if (type === 'docker') {
    return '#2496ED';
  }
  return '#6B7280';
}

async function getAllWatchers() {
  const response = await fetch('/api/v1/watchers', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get watchers: ${response.statusText}`);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData(payload);
}

function buildWatcherDetailPath({ type, name, agent }: WatcherDetailPathOptions) {
  const segments = ['/api/v1/watchers'];
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  return segments.join('/');
}

async function getWatcher({ type, name, agent }: WatcherDetailPathOptions) {
  const response = await fetch(buildWatcherDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get watcher: ${response.statusText}`);
  }
  return readJsonResponse(response);
}

export { getAllWatchers, getWatcher, getWatcherProviderColor, getWatcherProviderIcon };
