import { readJsonResponse } from '../utils/api';
import type { WatcherEditOutcome, WatcherEditRequest, WatcherEditRow } from './config-editor';

export const actionEditFields = ['auto', 'order', 'concurrency'] as const;
export type ActionEditField = (typeof actionEditFields)[number];
export const actionAutoModes = ['all', 'oninclude', 'onauto', 'none'] as const;
export interface ActionIdentity {
  id: string;
  type: string;
  name: string;
  agent?: string;
}
export interface ActionEditRow extends ActionIdentity {
  category: 'action';
  fields: Record<ActionEditField, WatcherEditRow['fields']['cron']>;
}
export interface ActionEditSnapshot {
  available: boolean;
  revision?: string;
  readOnlyReason?: string;
  actions: ActionEditRow[];
}
export function isActionProvider(type: string) {
  return ['docker', 'dockercompose', 'portainer', 'command'].includes(type.toLowerCase());
}
export class ActionEditorHttpError extends Error {
  constructor(public status: number) {
    super(`Action editor HTTP ${status}`);
  }
}
const endpoint = '/api/v1/config/editor/actions';
export async function getActionEditor(): Promise<ActionEditSnapshot> {
  const response = await fetch(endpoint, {
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ActionEditorHttpError(response.status);
  return readJsonResponse<ActionEditSnapshot>(response, 'Action editor');
}
export async function saveActionEdits(request: WatcherEditRequest): Promise<WatcherEditOutcome> {
  const response = await fetch(endpoint, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  let body: WatcherEditOutcome;
  try {
    body = await readJsonResponse<WatcherEditOutcome>(response, 'Action editor');
  } catch (error) {
    if (!response.ok) throw new ActionEditorHttpError(response.status);
    throw error;
  }
  if (
    typeof body?.saved !== 'boolean' ||
    typeof body.applied !== 'boolean' ||
    !Array.isArray(body.errors) ||
    !Array.isArray(body.changedKeys) ||
    !Array.isArray(body.restartRequired) ||
    (body.reload !== undefined &&
      (typeof body.reload?.applied !== 'boolean' || !Array.isArray(body.reload.errors)))
  )
    throw new ActionEditorHttpError(response.status);
  return { ...body, status: response.status };
}
