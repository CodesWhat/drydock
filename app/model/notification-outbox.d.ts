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
  /**
   * Last delivery failure. This may include downstream provider/webhook
   * response bodies because it is only exposed through admin-gated outbox
   * views/APIs.
   */
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
  failedAt?: string;
}
