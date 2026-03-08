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
import { authPaths } from './auth.js';
import { componentReadPaths } from './component-read.js';
import { containerPaths } from './containers.js';
import { triggerPaths } from './triggers.js';

export const openApiPaths = {
  '/health': {
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
  },
  '/api/openapi.json': {
    get: {
      tags: ['Docs'],
      summary: 'Get OpenAPI document',
      operationId: 'getOpenApiDocument',
      security: [],
      responses: {
        200: jsonResponse('OpenAPI document', { ...genericObjectSchema }),
      },
    },
  },
  '/api/app': {
    get: {
      tags: ['System'],
      summary: 'Get application information',
      operationId: 'getAppInfo',
      security: [],
      responses: {
        200: jsonResponse('Application metadata', { $ref: '#/components/schemas/AppInfo' }),
      },
    },
  },
  '/api/webhook/watch': {
    post: {
      tags: ['Webhook'],
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
  },
  '/api/webhook/watch/{containerName}': {
    post: {
      tags: ['Webhook'],
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
  },
  '/api/webhook/update/{containerName}': {
    post: {
      tags: ['Webhook'],
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
  },
  ...authPaths,
  '/api/events/ui': {
    get: {
      tags: ['Realtime'],
      summary: 'Open authenticated UI SSE stream',
      operationId: 'openUiEventStream',
      responses: {
        200: {
          description: 'SSE stream',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
            },
          },
        },
        401: errorResponse('Authentication required'),
        429: errorResponse('SSE connection limit exceeded'),
      },
    },
  },
  '/api/events/ui/self-update/{operationId}/ack': {
    post: {
      tags: ['Realtime'],
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
  },
  '/api/log': {
    get: {
      tags: ['Logs'],
      summary: 'Get current log settings',
      operationId: 'getLogSettings',
      responses: {
        200: jsonResponse('Log settings', { $ref: '#/components/schemas/LogSettings' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/log/entries': {
    get: {
      tags: ['Logs'],
      summary: 'Get buffered log entries',
      operationId: 'getLogEntries',
      parameters: [
        {
          name: 'level',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
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
        200: jsonResponse('Log entries', { $ref: '#/components/schemas/GenericArray' }),
        400: errorResponse('Invalid log query parameter'),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/store': {
    get: {
      tags: ['System'],
      summary: 'Get storage configuration',
      operationId: 'getStoreConfig',
      responses: {
        200: jsonResponse('Store configuration', {
          $ref: '#/components/schemas/StoreConfigurationResponse',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/server': {
    get: {
      tags: ['System'],
      summary: 'Get server configuration and compatibility details',
      operationId: 'getServerInfo',
      responses: {
        200: jsonResponse('Server details', { $ref: '#/components/schemas/ServerInfoResponse' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/server/security/runtime': {
    get: {
      tags: ['System'],
      summary: 'Get runtime status of security tooling',
      operationId: 'getSecurityRuntimeStatus',
      responses: {
        200: jsonResponse('Security runtime status', {
          $ref: '#/components/schemas/SecurityRuntimeStatusResponse',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Runtime status lookup failed'),
      },
    },
  },
  ...containerPaths,
  ...triggerPaths,
  ...componentReadPaths,
  '/api/agents': {
    get: {
      tags: ['Agents'],
      summary: 'List known agents with health and inventory stats',
      operationId: 'listAgents',
      responses: {
        200: jsonResponse('Agent list', { $ref: '#/components/schemas/CollectionResult' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/agents/{name}/log/entries': {
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
          schema: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
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
  },
  '/api/audit': {
    get: {
      tags: ['Audit'],
      summary: 'Get audit entries with pagination and filtering',
      operationId: 'getAuditEntries',
      parameters: [
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200 },
        },
        { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'container', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'from',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date-time' },
        },
        {
          name: 'to',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date-time' },
        },
      ],
      responses: {
        200: jsonResponse('Audit entries page', { $ref: '#/components/schemas/PaginatedResult' }),
        400: errorResponse('Invalid audit query parameter'),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/icons/{provider}/{slug}': {
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
  },
  '/api/icons/cache': {
    delete: {
      tags: ['Icons'],
      summary: 'Clear icon cache',
      operationId: 'clearIconCache',
      responses: {
        200: jsonResponse('Cache clear result', {
          $ref: '#/components/schemas/IconCacheClearResponse',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Failed to clear icon cache'),
      },
    },
  },
  '/api/settings': {
    get: {
      tags: ['System'],
      summary: 'Get API settings',
      operationId: 'getSettings',
      responses: {
        200: jsonResponse('Settings payload', { $ref: '#/components/schemas/Settings' }),
        401: errorResponse('Authentication required'),
      },
    },
    patch: {
      tags: ['System'],
      summary: 'Partially update API settings',
      operationId: 'updateSettings',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                internetlessMode: { type: 'boolean' },
              },
              minProperties: 1,
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated settings', { $ref: '#/components/schemas/Settings' }),
        400: errorResponse('Invalid settings payload'),
        401: errorResponse('Authentication required'),
      },
    },
    put: {
      tags: ['System'],
      summary: 'Update API settings (deprecated; use PATCH)',
      operationId: 'updateSettingsDeprecatedPut',
      deprecated: true,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                internetlessMode: { type: 'boolean' },
              },
              minProperties: 1,
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated settings', { $ref: '#/components/schemas/Settings' }),
        400: errorResponse('Invalid settings payload'),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List notification rules',
      operationId: 'listNotificationRules',
      responses: {
        200: jsonResponse('Notification rules', {
          $ref: '#/components/schemas/CollectionResult',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/notifications/{id}': {
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
  },
  '/metrics': {
    get: {
      tags: ['Metrics'],
      summary: 'Get Prometheus metrics',
      operationId: 'getPrometheusMetrics',
      description:
        'By default this endpoint requires authentication. It can be exposed without auth when DD_SERVER_METRICS_AUTH=false.',
      responses: {
        200: {
          description: 'Prometheus metrics text',
          content: {
            'text/plain': {
              schema: { type: 'string' },
            },
          },
        },
        401: errorResponse('Authentication required when metrics auth is enabled'),
      },
    },
  },
} as const;
