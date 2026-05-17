import {
  agentNamePathParam,
  containerNamePathParam,
  errorResponse,
  genericObjectSchema,
  iconProviderPathParam,
  iconSlugPathParam,
  jsonResponse,
  notificationRuleIdPathParam,
  operationIdPathParam,
} from '../common.js';
import { openApiPaths } from './index.js';

describe('openApiPaths', () => {
  describe('createWebhookContainerActionPost', () => {
    test('webhook watch-container path has exact full structure', () => {
      // Kills: L30:42 ({} errorResponses body), L31:24 ('Missing or invalid...'),
      //        L32:24 ('Webhooks are disabled for container'), L34:24 ('Webhook execution failed'),
      //        L37:10 (return {}), L38:11 (post: {}), L39:13 ([]), L39:14 ('Webhook'),
      //        L39:25 ('Actions'), L42:17 ([security]), L42:18 ({webhookBearerAuth}),
      //        L42:39 ([] inner), L43:19 ([params]), L44:18 (responses {}),
      //        L45:47 ({$ref schema}), L46:17 ('WebhookContainerActionResponse ref')
      expect(openApiPaths['/api/webhook/watch/{containerName}']).toStrictEqual({
        post: {
          tags: ['Webhook', 'Actions'],
          summary: 'Trigger watch for a specific container by name',
          operationId: 'webhookWatchContainer',
          security: [{ webhookBearerAuth: [] }],
          parameters: [containerNamePathParam],
          responses: {
            200: jsonResponse('Container watch triggered', {
              $ref: '#/components/schemas/WebhookContainerActionResponse',
            }),
            401: errorResponse('Missing or invalid webhook authorization header'),
            403: errorResponse('Webhooks are disabled for container'),
            404: errorResponse('Container not found'),
            500: errorResponse('Webhook execution failed'),
          },
        },
      });
    });

    test('webhook update-container path has exact full structure with different notFoundMessage', () => {
      // Kills the same set of mutants via a different call with a different notFoundMessage
      expect(openApiPaths['/api/webhook/update/{containerName}']).toStrictEqual({
        post: {
          tags: ['Webhook', 'Actions'],
          summary: 'Trigger update for a specific container by name',
          operationId: 'webhookUpdateContainer',
          security: [{ webhookBearerAuth: [] }],
          parameters: [containerNamePathParam],
          responses: {
            200: jsonResponse('Container update triggered', {
              $ref: '#/components/schemas/WebhookContainerActionResponse',
            }),
            401: errorResponse('Missing or invalid webhook authorization header'),
            403: errorResponse('Webhooks are disabled for container'),
            404: errorResponse('Container or docker trigger not found'),
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
          },
        },
      });
    });

    test('/api/openapi.json path uses generic object schema', () => {
      expect(openApiPaths['/api/openapi.json']).toStrictEqual({
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

    test('/api/webhook/watch path is fully specified', () => {
      expect(openApiPaths['/api/webhook/watch']).toStrictEqual({
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

    test('/api/events/ui/self-update/{operationId}/ack path is fully specified', () => {
      expect(openApiPaths['/api/events/ui/self-update/{operationId}/ack']).toStrictEqual({
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

    test('/api/agents/{name}/log/entries path is fully specified', () => {
      expect(openApiPaths['/api/agents/{name}/log/entries']).toStrictEqual({
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

    test('/api/icons/{provider}/{slug} path is fully specified', () => {
      expect(openApiPaths['/api/icons/{provider}/{slug}']).toStrictEqual({
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

    test('/api/notifications/{id} path is fully specified', () => {
      expect(openApiPaths['/api/notifications/{id}']).toStrictEqual({
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
  });
});
