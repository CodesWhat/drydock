export type NotificationOutboxEntryStatus = 'pending' | 'delivered' | 'dead-letter';

export interface NotificationOutboxEntry {
  id: string;
  eventName: string;
  triggerId: string;
  containerId?: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  status: NotificationOutboxEntryStatus;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
  failedAt?: string;
}

export interface NotificationOutboxStatusCounts {
  pending: number;
  delivered: number;
  deadLetter: number;
}

export interface NotificationOutboxResponse {
  data: NotificationOutboxEntry[];
  total: number;
  counts: NotificationOutboxStatusCounts;
}

async function getOutboxEntries(
  status?: NotificationOutboxEntryStatus,
): Promise<NotificationOutboxResponse> {
  const url = status
    ? `/api/notifications/outbox?status=${encodeURIComponent(status)}`
    : '/api/notifications/outbox';
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load outbox: ${response.statusText}`);
  }
  return (await response.json()) as NotificationOutboxResponse;
}

async function retryOutboxEntry(id: string): Promise<NotificationOutboxEntry> {
  const response = await fetch(`/api/notifications/outbox/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.error || `Failed to retry entry: ${response.statusText}`);
    (error as Error & { statusCode?: number }).statusCode = response.status;
    throw error;
  }
  return (await response.json()) as NotificationOutboxEntry;
}

async function deleteOutboxEntry(id: string): Promise<void> {
  const response = await fetch(`/api/notifications/outbox/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.error || `Failed to delete entry: ${response.statusText}`);
    (error as Error & { statusCode?: number }).statusCode = response.status;
    throw error;
  }
}

export { deleteOutboxEntry, getOutboxEntries, retryOutboxEntry };
