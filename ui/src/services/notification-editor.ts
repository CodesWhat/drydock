import { readJsonResponse } from '../utils/api';
import type { WatcherEditOutcome, WatcherEditRequest, WatcherEditRow } from './config-editor';

export const notificationEditFields = [
  'threshold',
  'once',
  'mode',
  'securitymode',
  'digestcron',
  'resolvenotifications',
  'securitydigesttitle',
  'securitydigestbody',
] as const;
export type NotificationEditField = (typeof notificationEditFields)[number];
export const notificationThresholds = [
  'all',
  'major',
  'minor',
  'patch',
  'major-only',
  'minor-only',
  'digest',
  'major-no-digest',
  'minor-no-digest',
  'patch-no-digest',
  'major-only-no-digest',
  'minor-only-no-digest',
] as const;
export const notificationModes = ['simple', 'batch', 'digest', 'batch+digest'] as const;
export interface NotificationIdentity {
  id: string;
  type: string;
  name: string;
  agent?: string;
}
export interface NotificationEditRow extends NotificationIdentity {
  category: 'notification';
  fields: Record<
    Exclude<NotificationEditField, 'securitydigesttitle' | 'securitydigestbody'>,
    WatcherEditRow['fields']['cron']
  > &
    Partial<Record<'securitydigesttitle' | 'securitydigestbody', WatcherEditRow['fields']['cron']>>;
}
export interface NotificationEditSnapshot {
  available: boolean;
  revision?: string;
  readOnlyReason?: string;
  triggers: NotificationEditRow[];
}

export function isNotificationProvider(type: string) {
  return !['docker', 'dockercompose', 'portainer', 'command'].includes(type.toLowerCase());
}
export class NotificationEditorHttpError extends Error {
  constructor(public status: number) {
    super(`Notification editor HTTP ${status}`);
  }
}
const endpoint = '/api/v1/config/editor/triggers';
export async function getNotificationEditor(): Promise<NotificationEditSnapshot> {
  const response = await fetch(endpoint, {
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new NotificationEditorHttpError(response.status);
  return readJsonResponse<NotificationEditSnapshot>(response, 'Notification editor');
}
export async function saveNotificationEdits(
  request: WatcherEditRequest,
): Promise<WatcherEditOutcome> {
  const response = await fetch(endpoint, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  let body: Partial<WatcherEditOutcome>;
  try {
    body = await readJsonResponse<Partial<WatcherEditOutcome>>(response, 'Notification editor');
  } catch (error) {
    if (!response.ok) throw new NotificationEditorHttpError(response.status);
    throw error;
  }
  if (
    typeof body?.saved !== 'boolean' ||
    typeof body.applied !== 'boolean' ||
    !Array.isArray(body.errors) ||
    !Array.isArray(body.changedKeys) ||
    !Array.isArray(body.restartRequired) ||
    (body.reload !== undefined &&
      (typeof body.reload?.applied !== 'boolean' || !Array.isArray(body.reload?.errors)))
  )
    throw new NotificationEditorHttpError(response.status);
  return { ...body, status: response.status } as WatcherEditOutcome;
}
