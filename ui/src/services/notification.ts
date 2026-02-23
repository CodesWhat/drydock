export interface NotificationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
}

export interface NotificationRuleUpdate {
  enabled?: boolean;
  triggers?: string[];
}

async function getAllNotificationRules(): Promise<NotificationRule[]> {
  const response = await fetch('/api/notifications', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get notifications: ${response.statusText}`);
  }
  return response.json();
}

async function updateNotificationRule(
  ruleId: string,
  update: NotificationRuleUpdate,
): Promise<NotificationRule> {
  const response = await fetch(`/api/notifications/${ruleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export { getAllNotificationRules, updateNotificationRule };
