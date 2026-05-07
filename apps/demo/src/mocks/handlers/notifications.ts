import { HttpResponse, http } from 'msw';
import type {
  NotificationOutboxEntry,
  NotificationOutboxEntryStatus,
} from '@/services/notification-outbox';
import { notificationOutboxEntries, notificationRules } from '../data/notifications';

const validOutboxStatuses = new Set<NotificationOutboxEntryStatus>([
  'pending',
  'delivered',
  'dead-letter',
]);

function isOutboxStatus(status: string | null): status is NotificationOutboxEntryStatus {
  return status !== null && validOutboxStatuses.has(status as NotificationOutboxEntryStatus);
}

function countOutboxStatuses(entries: NotificationOutboxEntry[]) {
  return {
    pending: entries.filter((entry) => entry.status === 'pending').length,
    delivered: entries.filter((entry) => entry.status === 'delivered').length,
    deadLetter: entries.filter((entry) => entry.status === 'dead-letter').length,
  };
}

function outboxResponse(status: NotificationOutboxEntryStatus) {
  const data = notificationOutboxEntries.filter((entry) => entry.status === status);

  return {
    data,
    total: data.length,
    counts: countOutboxStatuses(notificationOutboxEntries),
  };
}

export const notificationHandlers = [
  http.get('/api/v1/notifications', () => HttpResponse.json({ data: notificationRules })),

  http.get('/api/v1/notifications/outbox', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status');
    if (status !== null && !isOutboxStatus(status)) {
      return HttpResponse.json(
        {
          error: 'Invalid status query parameter. Must be one of: pending, delivered, dead-letter',
        },
        { status: 400 },
      );
    }

    return HttpResponse.json(outboxResponse(status ?? 'dead-letter'));
  }),

  http.post('/api/v1/notifications/outbox/:id/retry', ({ params }) => {
    const index = notificationOutboxEntries.findIndex((entry) => entry.id === params.id);
    const entry = notificationOutboxEntries[index];

    if (!entry || entry.status !== 'dead-letter') {
      return HttpResponse.json(
        { error: 'Outbox entry not found or not in dead-letter status' },
        { status: 404 },
      );
    }

    const requeued: NotificationOutboxEntry = {
      ...entry,
      attempts: 0,
      status: 'pending',
      lastError: undefined,
      failedAt: undefined,
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    };
    notificationOutboxEntries[index] = requeued;

    return HttpResponse.json(requeued);
  }),

  http.delete('/api/v1/notifications/outbox/:id', ({ params }) => {
    const index = notificationOutboxEntries.findIndex((entry) => entry.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Outbox entry not found' }, { status: 404 });
    }

    notificationOutboxEntries.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch('/api/v1/notifications/:id', async ({ params, request }) => {
    const rule = notificationRules.find((r) => r.id === params.id);
    if (!rule) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...rule, ...body });
  }),
];
