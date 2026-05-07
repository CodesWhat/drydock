import { readJsonResponse } from '../utils/api';

export type NotificationOutboxEntryStatus = 'pending' | 'delivered' | 'dead-letter';

export interface NotificationOutboxEntry {
  id: string;
  eventName: string;
  triggerId: string;
  containerId?: string;
  /** API-safe projection of the delivery payload; full container payloads are not exposed. */
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  status: NotificationOutboxEntryStatus;
  /**
   * Last delivery failure. Admin-only: provider/webhook response bodies may be
   * present when downstream delivery returns diagnostic text. Authorization
   * header values are redacted by the backend.
   */
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

const OUTBOX_API_BASE = '/api/v1/notifications/outbox';

type ErrorEnvelope = {
  error?: unknown;
};

function messageFromErrorEnvelope(body: ErrorEnvelope, fallback: string): string {
  return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
}

async function readErrorEnvelope(response: Response, context: string): Promise<ErrorEnvelope> {
  try {
    return await readJsonResponse<ErrorEnvelope>(response, context);
  } catch {
    return {};
  }
}

function withStatusCode(error: Error, statusCode: number): Error & { statusCode?: number } {
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error as Error & { statusCode?: number };
}

async function getOutboxEntries(
  status?: NotificationOutboxEntryStatus,
): Promise<NotificationOutboxResponse> {
  const url = status ? `${OUTBOX_API_BASE}?status=${encodeURIComponent(status)}` : OUTBOX_API_BASE;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const body = await readErrorEnvelope(response, 'Outbox API');
    throw new Error(
      messageFromErrorEnvelope(body, `Failed to load outbox: ${response.statusText}`),
    );
  }
  return readJsonResponse<NotificationOutboxResponse>(response, 'Outbox API');
}

async function retryOutboxEntry(id: string): Promise<NotificationOutboxEntry> {
  const response = await fetch(`${OUTBOX_API_BASE}/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await readErrorEnvelope(response, 'Outbox retry API');
    throw withStatusCode(
      new Error(messageFromErrorEnvelope(body, `Failed to retry entry: ${response.statusText}`)),
      response.status,
    );
  }
  return readJsonResponse<NotificationOutboxEntry>(response, 'Outbox retry API');
}

async function deleteOutboxEntry(id: string): Promise<void> {
  const response = await fetch(`${OUTBOX_API_BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await readErrorEnvelope(response, 'Outbox delete API');
    throw withStatusCode(
      new Error(messageFromErrorEnvelope(body, `Failed to delete entry: ${response.statusText}`)),
      response.status,
    );
  }
}

export { deleteOutboxEntry, getOutboxEntries, retryOutboxEntry };
