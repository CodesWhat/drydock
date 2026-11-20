import { errorResponse, jsonResponse, noContentResponse } from '../common.js';

const silenceIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Notification silence identifier',
  schema: { type: 'string' },
};

export const notificationSilencePaths = {
  '/api/v1/notifications/silences': {
    get: {
      tags: ['Notifications'],
      summary: 'List active notification silences',
      description:
        'Active silences, the configured quiet hours (null when none) and how many notifications each rule has dropped since the process started.',
      operationId: 'listNotificationSilences',
      responses: {
        200: jsonResponse('Active silences', {
          $ref: '#/components/schemas/NotificationSilenceResult',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Internal server error'),
      },
    },
    post: {
      tags: ['Notifications', 'Actions'],
      summary: 'Silence notifications for a while',
      description:
        'Mutes one rule, or every rule when `ruleId` is omitted, until it expires. A global silence spares `security-alert` and `update-failed` unless `DD_ALERTS_QUIETHOURS_EXEMPT` says otherwise; a silence that names a rule always applies. Provide exactly one of `durationMinutes` or `expiresAt`.',
      operationId: 'createNotificationSilence',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ruleId: { type: 'string' },
                durationMinutes: { type: 'integer', minimum: 1, maximum: 43200 },
                expiresAt: { type: 'string', format: 'date-time' },
                reason: { type: 'string', maxLength: 200 },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        201: jsonResponse('Created silence', { $ref: '#/components/schemas/NotificationSilence' }),
        400: errorResponse('Invalid silence request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Notification rule not found'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/notifications/silences/{id}': {
    delete: {
      tags: ['Notifications', 'Actions'],
      summary: 'Remove a notification silence',
      operationId: 'deleteNotificationSilence',
      parameters: [silenceIdPathParam],
      responses: {
        204: noContentResponse,
        401: errorResponse('Authentication required'),
        404: errorResponse('Notification silence not found'),
        500: errorResponse('Internal server error'),
      },
    },
  },
} as const;
