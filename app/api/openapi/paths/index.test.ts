import {
  agentNamePathParam,
  containerNamePathParam,
  errorResponse,
  genericObjectSchema,
  iconProviderPathParam,
  iconSlugPathParam,
  jsonResponse,
  noContentResponse,
  notificationRuleIdPathParam,
  operationIdPathParam,
} from '../common.js';
import { openApiPaths } from './index.js';

const webhookAgentQueryParam = {
  name: 'agent',
  in: 'query',
  required: false,
  description:
    'Agent name used to disambiguate duplicate container names; use __local__ for controller-local containers without an agent',
  schema: { type: 'string' },
};

const webhookWatcherQueryParam = {
  name: 'watcher',
  in: 'query',
  required: false,
  description: 'Watcher name used to disambiguate duplicate container names',
  schema: { type: 'string' },
};

describe('openApiPaths', () => {
  describe('createWebhookContainerActionPost', () => {
    test('webhook watch-container path has exact full structure', () => {
      // Kills: L30:42 ({} errorResponses body), L31:24 ('Missing or invalid...'),
      //        L32:24 ('Webhooks are disabled for container'), L34:24 ('Webhook execution failed'),
      //        L37:10 (return {}), L38:11 (post: {}), L39:13 ([]), L39:14 ('Webhook'),
      //        L39:25 ('Actions'), L42:17 ([security]), L42:18 ({webhookBearerAuth}),
      //        L42:39 ([] inner), L43:19 ([params]), L44:18 (responses {}),
      //        L45:47 ({$ref schema}), L46:17 ('WebhookContainerActionResponse ref')
      expect(openApiPaths['/api/v1/webhook/watch/{containerName}']).toStrictEqual({
        post: {
          tags: ['Webhook', 'Actions'],
          summary: 'Trigger watch for a specific container by name',
          operationId: 'webhookWatchContainer',
          security: [{ webhookBearerAuth: [] }],
          parameters: [containerNamePathParam, webhookAgentQueryParam, webhookWatcherQueryParam],
          responses: {
            200: jsonResponse('Container watch triggered', {
              $ref: '#/components/schemas/WebhookContainerActionResponse',
            }),
            401: errorResponse('Missing or invalid webhook authorization header'),
            403: errorResponse('Webhooks are disabled for container'),
            404: errorResponse('Container not found'),
            409: errorResponse('Ambiguous container name'),
            500: errorResponse('Webhook execution failed'),
          },
        },
      });
    });

    test('webhook update-container path has exact full structure with different notFoundMessage', () => {
      // Kills the same set of mutants via a different call with a different notFoundMessage
      expect(openApiPaths['/api/v1/webhook/update/{containerName}']).toStrictEqual({
        post: {
          tags: ['Webhook', 'Actions'],
          summary: 'Trigger update for a specific container by name',
          operationId: 'webhookUpdateContainer',
          security: [{ webhookBearerAuth: [] }],
          parameters: [containerNamePathParam, webhookAgentQueryParam, webhookWatcherQueryParam],
          responses: {
            202: jsonResponse('Container update accepted', {
              $ref: '#/components/schemas/WebhookContainerUpdateAcceptedResponse',
            }),
            401: errorResponse('Missing or invalid webhook authorization header'),
            403: errorResponse('Webhooks are disabled for container'),
            404: errorResponse('Container or docker trigger not found'),
            409: errorResponse('Ambiguous container name or update cannot be queued'),
            500: errorResponse('Webhook execution failed'),
          },
        },
      });
    });
  });

  describe('static path entries', () => {
    test('/health path is fully specified', () => {
      expect(openApiPaths['/health']).toStrictEqual({
        get: {
          tags: ['System'],
          summary: 'Health check',
          operationId: 'getHealth',
          security: [],
          responses: {
            200: jsonResponse('Health check response', {
              $ref: '#/components/schemas/HealthResponse',
            }),
            503: jsonResponse('Service is starting', {
              type: 'object',
              required: ['status', 'reason'],
              properties: {
                status: { type: 'string', enum: ['starting'] },
                reason: { type: 'string' },
              },
              additionalProperties: false,
            }),
          },
        },
      });
    });

    test('/api/v1/openapi.json path uses generic object schema', () => {
      expect(openApiPaths['/api/v1/openapi.json']).toStrictEqual({
        get: {
          tags: ['Docs'],
          summary: 'Get OpenAPI document',
          operationId: 'getOpenApiDocument',
          security: [],
          responses: {
            200: jsonResponse('OpenAPI document', { ...genericObjectSchema }),
          },
        },
      });
    });

    test('/api/auth/status compatibility alias is documented', () => {
      expect(openApiPaths['/api/auth/status']).toStrictEqual({
        get: {
          tags: ['Authentication'],
          summary: 'Get authentication provider registration status (compatibility alias)',
          operationId: 'getAuthStatusApiAlias',
          security: [],
          responses: {
            200: jsonResponse('Authentication provider status', {
              $ref: '#/components/schemas/AuthStatusResponse',
            }),
          },
        },
      });
    });

    test('/api/v1/webhook/watch path is fully specified', () => {
      expect(openApiPaths['/api/v1/webhook/watch']).toStrictEqual({
        post: {
          tags: ['Webhook', 'Actions'],
          summary: 'Trigger full watch cycle on all watchers',
          operationId: 'webhookWatchAll',
          security: [{ webhookBearerAuth: [] }],
          responses: {
            200: jsonResponse('Watch cycle triggered', {
              $ref: '#/components/schemas/WebhookWatchAllResponse',
            }),
            401: errorResponse('Missing or invalid webhook authorization header'),
            403: errorResponse('Webhooks are disabled'),
            500: errorResponse('Webhook execution failed'),
          },
        },
      });
    });

    test('/api/v1/webhooks/registry uses registry signature auth', () => {
      expect(openApiPaths['/api/v1/webhooks/registry']).toMatchObject({
        post: {
          security: [{ registryWebhookSignature: [] }],
          responses: {
            202: jsonResponse('Registry webhook processed', {
              $ref: '#/components/schemas/RegistryWebhookResponse',
            }),
            401: errorResponse('Missing or invalid registry webhook signature'),
          },
        },
      });
    });

    test('/api/v1/events/ui/self-update/{operationId}/ack path is fully specified', () => {
      expect(openApiPaths['/api/v1/events/ui/self-update/{operationId}/ack']).toStrictEqual({
        post: {
          tags: ['Realtime', 'Actions'],
          summary: 'Acknowledge self-update event for this SSE client',
          operationId: 'acknowledgeSelfUpdate',
          parameters: [operationIdPathParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['clientId', 'clientToken'],
                  properties: {
                    clientId: { type: 'string' },
                    clientToken: { type: 'string' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            202: jsonResponse('Acknowledgement processed', {
              $ref: '#/components/schemas/SelfUpdateAckResponse',
            }),
            400: errorResponse('Missing required fields'),
            401: errorResponse('Authentication required'),
            403: errorResponse('Client token rejected'),
          },
        },
      });
    });

    test('/api/v1/agents/{name}/log/entries path is fully specified', () => {
      expect(openApiPaths['/api/v1/agents/{name}/log/entries']).toStrictEqual({
        get: {
          tags: ['Agents'],
          summary: 'Get log entries from a connected agent',
          operationId: 'getAgentLogEntries',
          parameters: [
            agentNamePathParam,
            {
              name: 'level',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
              },
            },
            {
              name: 'component',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'tail',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 0 },
            },
            {
              name: 'since',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 0 },
            },
          ],
          responses: {
            200: jsonResponse('Agent log entries', { $ref: '#/components/schemas/GenericArray' }),
            400: errorResponse('Invalid log query parameter'),
            401: errorResponse('Authentication required'),
            404: errorResponse('Agent not found'),
            502: errorResponse('Failed to fetch logs from agent'),
            503: errorResponse('Agent is not connected'),
          },
        },
      });
    });

    test('/api/v1/icons/{provider}/{slug} path is fully specified', () => {
      expect(openApiPaths['/api/v1/icons/{provider}/{slug}']).toStrictEqual({
        get: {
          tags: ['Icons'],
          summary: 'Get icon from cache, bundled assets, or upstream CDN',
          operationId: 'getIcon',
          parameters: [iconProviderPathParam, iconSlugPathParam],
          responses: {
            200: {
              description: 'Icon content',
              content: {
                'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
                'image/png': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: errorResponse('Invalid icon request'),
            401: errorResponse('Authentication required'),
            404: errorResponse('Icon not found'),
            429: errorResponse('Too many requests'),
            502: errorResponse('Unable to fetch icon upstream'),
          },
        },
      });
    });

    test('/api/v1/notifications/{id} path is fully specified', () => {
      expect(openApiPaths['/api/v1/notifications/{id}']).toStrictEqual({
        patch: {
          tags: ['Notifications'],
          summary: 'Update notification rule',
          operationId: 'updateNotificationRule',
          parameters: [notificationRuleIdPathParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    triggers: {
                      type: 'array',
                      items: { type: 'string' },
                      uniqueItems: true,
                    },
                  },
                  minProperties: 1,
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            200: jsonResponse('Updated notification rule', {
              $ref: '#/components/schemas/NotificationRule',
            }),
            400: errorResponse('Invalid notification rule update'),
            401: errorResponse('Authentication required'),
            404: errorResponse('Notification rule not found'),
          },
        },
      });
    });

    test('/api/v1/notifications/outbox GET path is fully specified', () => {
      expect(openApiPaths['/api/v1/notifications/outbox']).toStrictEqual({
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
          },
        },
      });
    });

    test('/api/v1/notifications/outbox/{id}/retry POST path is fully specified', () => {
      const outboxEntryIdPathParam = {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Outbox entry identifier',
        schema: { type: 'string' },
      };
      expect(openApiPaths['/api/v1/notifications/outbox/{id}/retry']).toStrictEqual({
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
      });
    });

    test('/api/v1/notifications/outbox/{id} DELETE path is fully specified', () => {
      const outboxEntryIdPathParam = {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Outbox entry identifier',
        schema: { type: 'string' },
      };
      expect(openApiPaths['/api/v1/notifications/outbox/{id}']).toStrictEqual({
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
      });
    });

    test('/api/v1/operations/{id}/cancel POST path is fully specified', () => {
      const updateOperationIdPathParam = {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Update operation identifier',
        schema: { type: 'string' },
      };
      expect(openApiPaths['/api/v1/operations/{id}/cancel']).toStrictEqual({
        post: {
          tags: ['Containers', 'Actions'],
          summary: 'Request cancellation of an active update operation',
          operationId: 'cancelUpdateOperation',
          parameters: [updateOperationIdPathParam],
          responses: {
            200: jsonResponse('Operation cancelled immediately', {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/UpdateOperation' },
              },
              required: ['data'],
              additionalProperties: false,
            }),
            202: jsonResponse(
              'Cancellation requested; operation will abort at the next safe checkpoint',
              {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/UpdateOperation' },
                },
                required: ['data'],
                additionalProperties: false,
              },
            ),
            401: errorResponse('Authentication required'),
            404: errorResponse('Operation not found'),
            409: errorResponse('Operation is not active'),
            500: errorResponse('Internal server error'),
          },
        },
      });
    });

    test('/api/v1/update-operations/{id} GET path is fully specified', () => {
      const updateOperationIdPathParam = {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Update operation identifier',
        schema: { type: 'string' },
      };
      expect(openApiPaths['/api/v1/update-operations/{id}']).toStrictEqual({
        get: {
          tags: ['Containers'],
          summary: 'Get a single update operation by id',
          operationId: 'getUpdateOperationById',
          parameters: [updateOperationIdPathParam],
          responses: {
            200: jsonResponse('Update operation', {
              $ref: '#/components/schemas/UpdateOperation',
            }),
            400: errorResponse('Operation id is required'),
            401: errorResponse('Authentication required'),
            404: errorResponse('Update operation not found'),
          },
        },
      });
    });

    test('/api/v1/audit documents single and multi-action filters', () => {
      const parameterNames = openApiPaths['/api/v1/audit'].get.parameters.map((p) => p.name);

      expect(parameterNames).toEqual(expect.arrayContaining(['action', 'actions']));
    });

    test('/api/v1/self-update/{operationId}/status GET path is fully specified', () => {
      expect(openApiPaths['/api/v1/self-update/{operationId}/status']).toStrictEqual({
        get: {
          tags: ['System'],
          summary: 'Get self-update operation status',
          operationId: 'getSelfUpdateOperationStatus',
          security: [],
          parameters: [operationIdPathParam],
          responses: {
            200: jsonResponse('Self-update operation status', {
              type: 'object',
              required: ['operationId', 'status', 'phase'],
              properties: {
                operationId: { type: 'string' },
                status: { type: 'string' },
                phase: { type: 'string' },
                completedAt: { type: 'string' },
              },
              additionalProperties: false,
            }),
            400: errorResponse('operationId is required'),
            404: errorResponse('Self-update operation not found'),
          },
        },
      });
    });
  });
});
