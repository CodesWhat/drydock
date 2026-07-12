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
import { notificationOutboxPaths } from './notification-outbox.js';
import { portwingPaths } from './portwing.js';
import { statsPaths } from './stats.js';
import { triggerPaths } from './triggers.js';

const updateOperationIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Update operation identifier',
  schema: { type: 'string' },
} as const;

const webhookAgentQueryParam = {
  name: 'agent',
  in: 'query',
  required: false,
  description:
    'Agent name used to disambiguate duplicate container names; use __local__ for controller-local containers without an agent',
  schema: { type: 'string' },
} as const;

const webhookWatcherQueryParam = {
  name: 'watcher',
  in: 'query',
  required: false,
  description: 'Watcher name used to disambiguate duplicate container names',
  schema: { type: 'string' },
} as const;

type ErrorResponses = Record<number, ReturnType<typeof errorResponse>>;

function createWebhookContainerActionPost({
  summary,
  operationId,
  successDescription,
  notFoundMessage,
}: {
  summary: string;
  operationId: string;
  successDescription: string;
  notFoundMessage: string;
}) {
  const errorResponses: ErrorResponses = {
    401: errorResponse('Missing or invalid webhook authorization header'),
    403: errorResponse('Webhooks are disabled for container'),
    404: errorResponse(notFoundMessage),
    409: errorResponse(
      operationId === 'webhookUpdateContainer'
        ? 'Ambiguous container name or update cannot be queued'
        : 'Ambiguous container name',
    ),
    500: errorResponse('Webhook execution failed'),
  };

  const successResponses =
    operationId === 'webhookUpdateContainer'
      ? {
          202: jsonResponse('Container update accepted', {
            $ref: '#/components/schemas/WebhookContainerUpdateAcceptedResponse',
          }),
        }
      : {
          200: jsonResponse(successDescription, {
            $ref: '#/components/schemas/WebhookContainerActionResponse',
          }),
        };

  return {
    post: {
      tags: ['Webhook', 'Actions'],
      summary,
      operationId,
      security: [{ webhookBearerAuth: [] }],
      parameters: [containerNamePathParam, webhookAgentQueryParam, webhookWatcherQueryParam],
      responses: {
        ...successResponses,
        ...errorResponses,
      },
    },
  };
}

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
  },
  '/api/v1/openapi.json': {
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
  '/api/v1/app': {
    get: {
      tags: ['System'],
      summary: 'Get application information',
      operationId: 'getAppInfo',
      responses: {
        200: jsonResponse('Application metadata', { $ref: '#/components/schemas/AppInfo' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/v1/webhook/watch': {
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
  },
  '/api/v1/webhook/watch/{containerName}': createWebhookContainerActionPost({
    summary: 'Trigger watch for a specific container by name',
    operationId: 'webhookWatchContainer',
    successDescription: 'Container watch triggered',
    notFoundMessage: 'Container not found',
  }),
  '/api/v1/webhook/update/{containerName}': createWebhookContainerActionPost({
    summary: 'Trigger update for a specific container by name',
    operationId: 'webhookUpdateContainer',
    successDescription: 'Container update triggered',
    notFoundMessage: 'Container or docker trigger not found',
  }),
  '/api/v1/webhooks/registry': {
    post: {
      tags: ['Webhook', 'Actions'],
      summary: 'Process a signed registry webhook and trigger matching container checks',
      operationId: 'processRegistryWebhook',
      security: [{ registryWebhookSignature: [] }],
      responses: {
        202: jsonResponse('Registry webhook processed', {
          $ref: '#/components/schemas/RegistryWebhookResponse',
        }),
        400: errorResponse('Unsupported registry webhook payload'),
        401: errorResponse('Missing or invalid registry webhook signature'),
        403: errorResponse('Registry webhooks are disabled'),
        429: errorResponse('Too many registry webhook requests'),
        500: errorResponse('Registry webhook secret is not configured'),
      },
    },
  },
  ...authPaths,
  '/api/v1/events/ui': {
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
  '/api/v1/events/ui/self-update/{operationId}/ack': {
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
  },
  '/api/v1/log': {
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
  '/api/v1/log/entries': {
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
  '/api/v1/log/components': {
    get: {
      tags: ['Logs'],
      summary: 'Get known log component names',
      operationId: 'getLogComponents',
      responses: {
        200: jsonResponse('Log component names', {
          type: 'array',
          items: { type: 'string' },
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/v1/store': {
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
  '/api/v1/debug/dump': {
    get: {
      tags: ['System'],
      summary: 'Download diagnostic debug dump',
      operationId: 'downloadDebugDump',
      parameters: [
        {
          name: 'minutes',
          in: 'query',
          required: false,
          description: 'How many recent minutes of event history to include',
          schema: { type: 'integer', minimum: 1, maximum: 1440, default: 30 },
        },
      ],
      responses: {
        200: {
          description: 'Redacted diagnostic dump JSON attachment',
          headers: {
            'Content-Disposition': {
              description: 'Attachment filename for the exported dump',
              schema: { type: 'string' },
            },
          },
          content: {
            'application/json': {
              schema: { ...genericObjectSchema },
            },
          },
        },
        401: errorResponse('Authentication required'),
        500: errorResponse('Unable to generate debug dump'),
      },
    },
  },
  '/api/v1/server': {
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
  '/api/v1/server/security/runtime': {
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
  ...statsPaths,
  '/api/v1/operations/{id}/cancel': {
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
  },
  '/api/v1/update-operations/{id}': {
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
  },
  '/api/v1/self-update/{operationId}/status': {
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
  },
  ...triggerPaths,
  ...portwingPaths,
  ...componentReadPaths,
  '/api/v1/agents': {
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
  '/api/v1/agents/{name}/log/entries': {
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
  '/api/v1/audit': {
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
        { name: 'actions', in: 'query', required: false, schema: { type: 'string' } },
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
  '/api/v1/icons/{provider}/{slug}': {
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
  '/api/v1/icons/cache': {
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
  '/api/v1/settings': {
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
                updateMode: { type: 'string', enum: ['notify', 'manual', 'auto'] },
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
                updateMode: { type: 'string', enum: ['notify', 'manual', 'auto'] },
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
  '/api/v1/preferences': {
    get: {
      tags: ['System'],
      summary: 'Get synced UI preferences for the current user',
      operationId: 'getPreferences',
      responses: {
        200: jsonResponse('Preferences payload', { $ref: '#/components/schemas/Preferences' }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Sync is not available in anonymous mode'),
      },
    },
    patch: {
      tags: ['System'],
      summary: 'Replace synced UI preferences for the current user (full-replace semantics)',
      operationId: 'updatePreferences',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                apiVersion: { type: 'integer', enum: [1] },
                schemaVersion: { type: 'integer', minimum: 1 },
                preferences: { type: 'object', additionalProperties: true },
              },
              required: ['apiVersion', 'schemaVersion', 'preferences'],
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated preferences', { $ref: '#/components/schemas/Preferences' }),
        400: errorResponse('Invalid preferences payload'),
        401: errorResponse('Authentication required'),
        403: errorResponse('Sync is not available in anonymous mode'),
        409: errorResponse('Preferences API version mismatch (apiVersion !== supported version)'),
        413: errorResponse(
          'Payload exceeds the global 256kb request body limit applied to all mutating /api/v1/* routes (app/api/api.ts) — no per-route override exists for this endpoint',
        ),
      },
    },
  },
  '/api/v1/notifications': {
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
  ...notificationOutboxPaths,
  '/api/v1/notifications/{id}': {
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
                bellEnabled: { type: 'boolean' },
                bellThreshold: { type: 'string', enum: ['all', 'major', 'minor', 'patch'] },
                templates: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      simpleTitle: { type: 'string' },
                      simpleBody: { type: 'string' },
                      batchTitle: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
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
  '/api/v1/notifications/{id}/preview': {
    post: {
      tags: ['Notifications'],
      summary: 'Preview notification templates',
      operationId: 'previewNotificationTemplates',
      parameters: [notificationRuleIdPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                triggerId: { type: 'string' },
                templates: {
                  type: 'object',
                  properties: {
                    simpleTitle: { type: 'string' },
                    simpleBody: { type: 'string' },
                    batchTitle: { type: 'string' },
                  },
                  additionalProperties: false,
                },
              },
              required: ['triggerId'],
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Rendered notification template preview', {
          type: 'object',
          properties: {
            simpleTitle: { type: 'string' },
            simpleBody: { type: 'string' },
            batchTitle: { type: 'string' },
          },
          required: ['simpleTitle', 'simpleBody', 'batchTitle'],
          additionalProperties: false,
        }),
        400: errorResponse('Invalid notification template preview'),
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
        'Returns Prometheus metrics. Auth modes: (1) bearer token via DD_SERVER_METRICS_TOKEN (recommended for Prometheus scrapers), (2) session/basic auth fallback when no token is set, (3) no auth when DD_SERVER_METRICS_AUTH=false.',
      security: [{ metricsBearerAuth: [] }, { sessionAuth: [] }, {}],
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
