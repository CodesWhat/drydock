import {
  agentNamePathParam,
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  containerIdPathParam,
  containerListQueryParams,
  containerNamePathParam,
  errorResponse,
  genericObjectSchema,
  iconProviderPathParam,
  iconSlugPathParam,
  jsonResponse,
  noContentResponse,
  notificationRuleIdPathParam,
  operationIdPathParam,
  paginationQueryParams,
  triggerAgentPathParam,
  triggerNamePathParam,
  triggerTypePathParam,
} from '../common.js';
import { componentReadPaths } from './component-read.js';

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
  '/api/auth/methods': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies (legacy alias)',
      operationId: 'getAuthMethodsAlias',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/GenericArray',
        }),
      },
    },
  },
  '/auth/strategies': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies',
      operationId: 'getAuthStrategies',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/GenericArray',
        }),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Authenticate and create session',
      operationId: 'login',
      security: [],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                remember: { type: 'boolean' },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Authenticated user', { $ref: '#/components/schemas/AuthUser' }),
        401: errorResponse('Authentication failed'),
        500: errorResponse('Unable to establish session'),
      },
    },
  },
  '/auth/remember': {
    post: {
      tags: ['Authentication'],
      summary: 'Persist remember-me preference for current session',
      operationId: 'setRememberMe',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                remember: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Remember-me preference saved', {
          $ref: '#/components/schemas/RememberMeResponse',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Session is unavailable'),
      },
    },
  },
  '/auth/user': {
    get: {
      tags: ['Authentication'],
      summary: 'Get current authenticated user',
      operationId: 'getCurrentUser',
      responses: {
        200: jsonResponse('Current user', { $ref: '#/components/schemas/AuthUser' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Authentication'],
      summary: 'Logout current user',
      operationId: 'logout',
      responses: {
        200: jsonResponse('Logout response', { $ref: '#/components/schemas/LogoutResponse' }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Unable to clear session'),
      },
    },
  },
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
  '/api/containers/groups': {
    get: {
      tags: ['Containers'],
      summary: 'Get containers grouped by stack/group label',
      operationId: 'getContainerGroups',
      responses: {
        200: jsonResponse('Container groups', {
          $ref: '#/components/schemas/CollectionResult',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/containers': {
    get: {
      tags: ['Containers'],
      summary: 'List containers',
      operationId: 'listContainers',
      parameters: containerListQueryParams,
      responses: {
        200: jsonResponse('Containers', { $ref: '#/components/schemas/PaginatedResult' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/containers/watch': {
    post: {
      tags: ['Containers'],
      summary: 'Trigger watch cycle for all watchers and return containers',
      operationId: 'watchAllContainers',
      responses: {
        200: jsonResponse('Updated containers', { $ref: '#/components/schemas/PaginatedResult' }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Watch operation failed'),
      },
    },
  },
  '/api/containers/summary': {
    get: {
      tags: ['Containers'],
      summary: 'Get lightweight container/security summary',
      operationId: 'getContainerSummary',
      responses: {
        200: jsonResponse('Container summary', {
          $ref: '#/components/schemas/ContainerSummaryResponse',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/containers/recent-status': {
    get: {
      tags: ['Containers'],
      summary: 'Get recent update status by container',
      operationId: 'getContainerRecentStatus',
      responses: {
        200: jsonResponse('Recent container statuses', {
          $ref: '#/components/schemas/ContainerRecentStatusResponse',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/containers/{id}': {
    get: {
      tags: ['Containers'],
      summary: 'Get a container by id',
      operationId: 'getContainerById',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container details', {
          $ref: '#/components/schemas/ContainerResource',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
    delete: {
      tags: ['Containers'],
      summary: 'Delete a container by id',
      operationId: 'deleteContainerById',
      parameters: [containerIdPathParam],
      responses: {
        204: noContentResponse,
        401: errorResponse('Authentication required'),
        403: errorResponse('Delete feature disabled'),
        404: errorResponse('Container not found'),
        500: errorResponse('Delete operation failed'),
      },
    },
  },
  '/api/containers/{id}/update-operations': {
    get: {
      tags: ['Containers'],
      summary: 'Get persisted update-operation history for a container',
      operationId: 'getContainerUpdateOperations',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Update operations', { $ref: '#/components/schemas/GenericArray' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
  },
  '/api/containers/{id}/triggers': {
    get: {
      tags: ['Containers'],
      summary: 'Get triggers associated to a container',
      operationId: 'getContainerTriggers',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container triggers', { $ref: '#/components/schemas/GenericArray' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
  },
  '/api/containers/{id}/triggers/{triggerType}/{triggerName}': {
    post: {
      tags: ['Containers'],
      summary: 'Run a local trigger for a container',
      operationId: 'runContainerTrigger',
      parameters: [containerIdPathParam, triggerTypePathParam, triggerNamePathParam],
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container or trigger not found'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
  '/api/containers/{id}/triggers/{triggerType}/{triggerName}/{triggerAgent}': {
    post: {
      tags: ['Containers'],
      summary: 'Run a remote trigger for a container',
      operationId: 'runRemoteContainerTrigger',
      parameters: [
        containerIdPathParam,
        triggerTypePathParam,
        triggerNamePathParam,
        triggerAgentPathParam,
      ],
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container or trigger not found'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
  '/api/containers/{id}/update-policy': {
    patch: {
      tags: ['Containers'],
      summary: 'Patch update policy for a container',
      operationId: 'patchContainerUpdatePolicy',
      parameters: [containerIdPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['action'],
              properties: {
                action: {
                  type: 'string',
                  enum: [
                    'skip-current',
                    'remove-skip',
                    'clear-skips',
                    'snooze',
                    'unsnooze',
                    'clear',
                  ],
                },
                kind: { type: 'string', enum: ['tag', 'digest'] },
                value: { type: 'string' },
                days: { type: 'number' },
                snoozeUntil: { type: 'string', format: 'date-time' },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated container', {
          $ref: '#/components/schemas/ContainerResource',
        }),
        400: errorResponse('Invalid update policy request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
  },
  '/api/containers/{id}/watch': {
    post: {
      tags: ['Containers'],
      summary: 'Watch a specific container',
      operationId: 'watchContainerById',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Updated container', {
          $ref: '#/components/schemas/ContainerResource',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
        500: errorResponse('Watch operation failed'),
      },
    },
  },
  '/api/containers/{id}/vulnerabilities': {
    get: {
      tags: ['Containers'],
      summary: 'Get vulnerability scan result for a container',
      operationId: 'getContainerVulnerabilities',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Vulnerability scan result', {
          $ref: '#/components/schemas/VulnerabilityScanResult',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
  },
  '/api/containers/{id}/sbom': {
    get: {
      tags: ['Containers'],
      summary: 'Get or generate SBOM for a container image',
      operationId: 'getContainerSbom',
      parameters: [
        containerIdPathParam,
        {
          name: 'format',
          in: 'query',
          required: false,
          description: 'SBOM format (defaults to spdx-json)',
          schema: {
            type: 'string',
            enum: ['spdx-json', 'cyclonedx-json'],
          },
        },
      ],
      responses: {
        200: jsonResponse('SBOM document', {
          $ref: '#/components/schemas/SbomDocumentResponse',
        }),
        400: errorResponse('Unsupported SBOM format'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
        500: errorResponse('SBOM generation failed'),
      },
    },
  },
  '/api/containers/{id}/env/reveal': {
    post: {
      tags: ['Containers'],
      summary: 'Reveal unredacted environment variables for a container',
      operationId: 'revealContainerEnv',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container environment variables', {
          $ref: '#/components/schemas/ContainerEnvResponse',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
        429: errorResponse('Too many requests'),
        501: errorResponse('Endpoint unavailable'),
      },
    },
  },
  '/api/containers/{id}/scan': {
    post: {
      tags: ['Containers'],
      summary: 'Run on-demand security scan for a container image',
      operationId: 'scanContainer',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Updated container with security state', {
          $ref: '#/components/schemas/ContainerResource',
        }),
        400: errorResponse('Security scanner is not configured'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
        429: errorResponse('Too many concurrent scans'),
        500: errorResponse('Security scan failed'),
      },
    },
  },
  '/api/containers/{id}/logs': {
    get: {
      tags: ['Logs'],
      summary: 'Get container logs',
      operationId: 'getContainerLogs',
      parameters: [
        containerIdPathParam,
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
        {
          name: 'timestamps',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: jsonResponse('Container logs', {
          $ref: '#/components/schemas/ContainerLogsResponse',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
        500: errorResponse('Unable to fetch logs'),
      },
    },
  },
  '/api/containers/{id}/preview': {
    post: {
      tags: ['Containers'],
      summary: 'Preview container update actions',
      operationId: 'previewContainerUpdate',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Preview result', {
          $ref: '#/components/schemas/PreviewResponse',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container or docker trigger not found'),
        500: errorResponse('Preview failed'),
      },
    },
  },
  '/api/containers/{id}/backups': {
    get: {
      tags: ['Containers'],
      summary: 'Get backups for a container',
      operationId: 'getContainerBackups',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container backups', { $ref: '#/components/schemas/GenericArray' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
      },
    },
  },
  '/api/containers/{id}/rollback': {
    post: {
      tags: ['Containers'],
      summary: 'Rollback container to backup image',
      operationId: 'rollbackContainer',
      parameters: [containerIdPathParam],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                backupId: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Rollback successful', {
          $ref: '#/components/schemas/ContainerRollbackResponse',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container, backup, or trigger not found'),
        500: errorResponse('Rollback failed'),
      },
    },
  },
  '/api/containers/{id}/start': {
    post: {
      tags: ['Containers'],
      summary: 'Start container',
      operationId: 'startContainer',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container started', {
          $ref: '#/components/schemas/ContainerActionResponse',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container or docker trigger not found'),
        500: errorResponse('Container start failed'),
      },
    },
  },
  '/api/containers/{id}/stop': {
    post: {
      tags: ['Containers'],
      summary: 'Stop container',
      operationId: 'stopContainer',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container stopped', {
          $ref: '#/components/schemas/ContainerActionResponse',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container or docker trigger not found'),
        500: errorResponse('Container stop failed'),
      },
    },
  },
  '/api/containers/{id}/restart': {
    post: {
      tags: ['Containers'],
      summary: 'Restart container',
      operationId: 'restartContainer',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container restarted', {
          $ref: '#/components/schemas/ContainerActionResponse',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container or docker trigger not found'),
        500: errorResponse('Container restart failed'),
      },
    },
  },
  '/api/containers/{id}/update': {
    post: {
      tags: ['Containers'],
      summary: 'Update container to latest available image',
      operationId: 'updateContainer',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Container updated', {
          $ref: '#/components/schemas/ContainerActionResponse',
        }),
        400: errorResponse('No update available for container'),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container or docker trigger not found'),
        500: errorResponse('Container update failed'),
      },
    },
  },
  '/api/triggers': {
    get: {
      tags: ['Triggers'],
      summary: 'List triggers',
      operationId: 'listTriggers',
      parameters: paginationQueryParams,
      responses: {
        200: jsonResponse('Triggers', { $ref: '#/components/schemas/PaginatedResult' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/triggers/{type}/{name}': {
    get: {
      tags: ['Triggers'],
      summary: 'Get trigger by type and name',
      operationId: 'getTriggerByTypeAndName',
      parameters: [componentTypePathParam, componentNamePathParam],
      responses: {
        200: jsonResponse('Trigger details', { $ref: '#/components/schemas/ComponentItem' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
    post: {
      tags: ['Triggers'],
      summary: 'Run trigger for a provided container payload',
      operationId: 'runTrigger',
      parameters: [componentTypePathParam, componentNamePathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Container payload used by trigger implementation',
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
  '/api/triggers/{type}/{name}/{agent}': {
    get: {
      tags: ['Triggers'],
      summary: 'Get remote trigger by type, name, and agent',
      operationId: 'getTriggerByTypeAndNameAndAgent',
      parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
      responses: {
        200: jsonResponse('Trigger details', { $ref: '#/components/schemas/ComponentItem' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
    post: {
      tags: ['Triggers'],
      summary: 'Run remote trigger for a provided container payload',
      operationId: 'runRemoteTrigger',
      parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Agent not found'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
  ...componentReadPaths,
  '/api/agents': {
    get: {
      tags: ['Agents'],
      summary: 'List known agents with health and inventory stats',
      operationId: 'listAgents',
      responses: {
        200: jsonResponse('Agent list', { $ref: '#/components/schemas/GenericArray' }),
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
        200: jsonResponse('Notification rules', { $ref: '#/components/schemas/GenericArray' }),
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
