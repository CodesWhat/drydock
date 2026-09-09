import { readJsonResponse } from '../utils/api';

export const watcherEditFields = [
  'cron',
  'maintenancewindow',
  'maintenancewindowtz',
  'maintenancewindowscope',
] as const;
export type WatcherEditField = (typeof watcherEditFields)[number];
type Scalar = string | number | boolean;

export interface WatcherIdentity {
  id: string;
  name: string;
  agent?: string;
}
export interface WatcherFieldDescriptor {
  path?: string[];
  present: boolean;
  value?: Scalar;
  effectiveValue?: Scalar;
  source: string;
  readOnlyReason?: string;
}
export interface WatcherEditRow extends WatcherIdentity {
  fields: Record<WatcherEditField, WatcherFieldDescriptor>;
}
export interface WatcherEditSnapshot {
  available: boolean;
  revision?: string;
  readOnlyReason?: string;
  watchers: WatcherEditRow[];
}
export interface WatcherEditChange {
  path: string[];
  operation: 'set' | 'remove';
  value?: Scalar;
}
export interface WatcherEditRequest {
  revision: string;
  changes: WatcherEditChange[];
}
export interface WatcherEditError {
  path: string;
  envKey: string;
  message: string;
}
export interface WatcherEditOutcome {
  status: number;
  saved: boolean;
  applied: boolean;
  revision?: string;
  changedKeys: string[];
  restartRequired: string[];
  errors: WatcherEditError[];
  reload?: {
    applied: boolean;
    errors: WatcherEditError[];
    reconcile?: {
      added: number;
      changed: number;
      removed: number;
      unchanged: number;
      errors: number;
    };
    orphanedRules?: Array<{ ruleId: string; triggerId: string }>;
  };
}

export class WatcherEditorHttpError extends Error {
  constructor(public status: number) {
    super(`Watcher editor HTTP ${status}`);
  }
}

const endpoint = '/api/v1/config/editor/watchers';

export async function getWatcherEditor(): Promise<WatcherEditSnapshot> {
  const response = await fetch(endpoint, {
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new WatcherEditorHttpError(response.status);
  return readJsonResponse<WatcherEditSnapshot>(response, 'Watcher editor');
}

export async function saveWatcherEdits(request: WatcherEditRequest): Promise<WatcherEditOutcome> {
  const response = await fetch(endpoint, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  const body = await readJsonResponse<Partial<WatcherEditOutcome>>(response, 'Watcher editor');
  if (
    typeof body?.saved !== 'boolean' ||
    typeof body.applied !== 'boolean' ||
    !Array.isArray(body.errors)
  )
    throw new WatcherEditorHttpError(response.status);
  return { ...body, status: response.status } as WatcherEditOutcome;
}
