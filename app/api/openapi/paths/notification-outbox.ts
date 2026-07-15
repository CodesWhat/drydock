import { errorResponse, jsonResponse, noContentResponse } from '../common.js';

const outboxEntryIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Outbox entry identifier',
  schema: { type: 'string' },
};

export const notificationOutboxPaths = {
  '/api/v1/notifications/outbox': {
    get: {
      tags: ['Notifications'],
      summary: 'List notification outbox entries',
      operationId: 'listNotificationOutboxEntries',
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          description: 'Filter by entry status (defaults to dead-letter)',
          schema: {
            type: 'string',
            enum: ['pending', 'delivered', 'dead-letter'],
          },
        },
      ],
      responses: {
        200: jsonResponse('Notification outbox entries', {
          $ref: '#/components/schemas/NotificationOutboxResult',
        }),
        400: errorResponse('Invalid status query parameter'),
        401: errorResponse('Authentication required'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/notifications/outbox/{id}/retry': {
    post: {
      tags: ['Notifications', 'Actions'],
      summary: 'Retry a dead-letter outbox entry',
      operationId: 'retryNotificationOutboxEntry',
      parameters: [outboxEntryIdPathParam],
      responses: {
        200: jsonResponse('Requeued outbox entry', {
          $ref: '#/components/schemas/NotificationOutboxEntry',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Outbox entry not found or not in dead-letter status'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/notifications/outbox/{id}': {
    delete: {
      tags: ['Notifications', 'Actions'],
      summary: 'Delete a notification outbox entry',
      operationId: 'deleteNotificationOutboxEntry',
      parameters: [outboxEntryIdPathParam],
      responses: {
        204: noContentResponse,
        401: errorResponse('Authentication required'),
        404: errorResponse('Outbox entry not found'),
        500: errorResponse('Internal server error'),
      },
    },
  },
} as const;
