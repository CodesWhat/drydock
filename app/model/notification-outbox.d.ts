export type NotificationOutboxEntryStatus = 'pending' | 'delivered' | 'dead-letter';

export interface NotificationOutboxEntry {
  id: string;
  eventName: string;
  payload: Record<string, unknown>;
  triggerId: string;
  containerId?: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  status: NotificationOutboxEntryStatus;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
  failedAt?: string;
}
