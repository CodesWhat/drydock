import { extractCollectionData, readJsonResponse } from '../utils/api';

export interface NotificationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
  bellEnabled: boolean;
  bellThreshold: NotificationBellThreshold;
  templates: NotificationTemplateOverrides;
}

export type NotificationBellThreshold = 'all' | 'major' | 'minor' | 'patch';

export interface NotificationTemplateOverride {
  simpleTitle?: string;
  simpleBody?: string;
  batchTitle?: string;
}

export type NotificationTemplateField = keyof NotificationTemplateOverride;

export type NotificationTemplateOverrides = Record<string, NotificationTemplateOverride>;

export type NotificationTemplatePreview = Required<NotificationTemplateOverride>;

export interface NotificationRuleUpdate {
  enabled?: boolean;
  triggers?: string[];
  bellEnabled?: boolean;
  bellThreshold?: NotificationBellThreshold;
  templates?: NotificationTemplateOverrides;
}

async function getAllNotificationRules(): Promise<NotificationRule[]> {
  const response = await fetch('/api/v1/notifications', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get notifications: ${response.statusText}`);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData<NotificationRule>(payload);
}

async function updateNotificationRule(
  ruleId: string,
  update: NotificationRuleUpdate,
): Promise<NotificationRule> {
  const response = await fetch(`/api/v1/notifications/${ruleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return readJsonResponse<NotificationRule>(response);
}

async function previewNotificationTemplates(
  ruleId: string,
  triggerId: string,
  templates: NotificationTemplateOverride,
): Promise<NotificationTemplatePreview> {
  const response = await fetch(`/api/v1/notifications/${ruleId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ triggerId, templates }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return readJsonResponse<NotificationTemplatePreview>(response);
}

export { getAllNotificationRules, previewNotificationTemplates, updateNotificationRule };
