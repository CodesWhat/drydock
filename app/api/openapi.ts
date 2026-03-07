import { getVersion } from '../configuration/index.js';

const genericObjectSchema = { type: 'object', additionalProperties: true };
const genericArraySchema = {
  type: 'array',
  items: { ...genericObjectSchema },
};
const emptyObjectSchema = { type: 'object', additionalProperties: false };
type JsonSchema = { $ref: string } | Record<string, unknown>;

const jsonContent = (schema: JsonSchema) => ({
  'application/json': { schema },
});

const jsonResponse = (description: string, schema: JsonSchema) => ({
  description,
  content: jsonContent(schema),
});

const errorResponse = (description: string) => ({
  description,
  content: jsonContent({ $ref: '#/components/schemas/ErrorResponse' }),
});

const noContentResponse = {
  description: 'No content',
};

const containerIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Container identifier',
  schema: { type: 'string' },
};

const componentTypePathParam = {
  name: 'type',
  in: 'path',
  required: true,
  description: 'Component type',
  schema: { type: 'string' },
};

const componentNamePathParam = {
  name: 'name',
  in: 'path',
  required: true,
  description: 'Component name',
  schema: { type: 'string' },
};

const componentAgentPathParam = {
  name: 'agent',
  in: 'path',
  required: true,
  description: 'Agent name',
  schema: { type: 'string' },
};

const triggerTypePathParam = {
  name: 'triggerType',
  in: 'path',
  required: true,
  description: 'Trigger type',
  schema: { type: 'string' },
};

const triggerNamePathParam = {
  name: 'triggerName',
  in: 'path',
  required: true,
  description: 'Trigger name',
  schema: { type: 'string' },
};

const triggerAgentPathParam = {
  name: 'triggerAgent',
  in: 'path',
  required: true,
  description: 'Trigger agent name',
  schema: { type: 'string' },
};

const agentNamePathParam = {
  name: 'name',
  in: 'path',
  required: true,
  description: 'Agent name',
  schema: { type: 'string' },
};

const operationIdPathParam = {
  name: 'operationId',
  in: 'path',
  required: true,
  description: 'Self-update operation identifier',
  schema: { type: 'string' },
};

const containerNamePathParam = {
  name: 'containerName',
  in: 'path',
  required: true,
  description: 'Container name',
  schema: { type: 'string' },
};

const iconProviderPathParam = {
  name: 'provider',
  in: 'path',
  required: true,
  description: 'Icon provider name',
  schema: { type: 'string' },
};

const iconSlugPathParam = {
  name: 'slug',
  in: 'path',
  required: true,
  description: 'Icon slug',
  schema: { type: 'string' },
};

const notificationRuleIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Notification rule identifier',
  schema: { type: 'string' },
};

const paginationQueryParams = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Max number of items to return (0-200)',
    schema: { type: 'integer', minimum: 0, maximum: 200 },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    description: 'Offset into results list',
    schema: { type: 'integer', minimum: 0 },
  },
];

const containerListQueryParams = [
  ...paginationQueryParams,
  {
    name: 'includeVulnerabilities',
    in: 'query',
    required: false,
    description: 'When true, include full vulnerability arrays in container payloads',
    schema: { type: 'boolean' },
  },
];

function createComponentReadOperations(options: {
  basePath: string;
  tag: string;
  nounPlural: string;
  nounSingular: string;
  operationPrefix: string;
}) {
  const { basePath, tag, nounPlural, nounSingular, operationPrefix } = options;
  return {
    [basePath]: {
      get: {
        tags: [tag],
        summary: `List ${nounPlural}`,
        operationId: `${operationPrefix}List`,
        parameters: paginationQueryParams,
        responses: {
          200: jsonResponse(`List of ${nounPlural}`, {
            $ref: '#/components/schemas/PaginatedResult',
          }),
          401: errorResponse('Authentication required'),
        },
      },
    },
    [`${basePath}/{type}/{name}`]: {
      get: {
        tags: [tag],
        summary: `Get ${nounSingular} by type and name`,
        operationId: `${operationPrefix}GetByTypeAndName`,
        parameters: [componentTypePathParam, componentNamePathParam],
        responses: {
          200: jsonResponse(`${nounSingular} details`, {
            $ref: '#/components/schemas/ComponentItem',
          }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${nounSingular} not found`),
        },
      },
    },
    [`${basePath}/{type}/{name}/{agent}`]: {
      get: {
        tags: [tag],
        summary: `Get remote ${nounSingular} by type, name, and agent`,
        operationId: `${operationPrefix}GetByTypeAndNameAndAgent`,
        parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
        responses: {
          200: jsonResponse(`${nounSingular} details`, {
            $ref: '#/components/schemas/ComponentItem',
          }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${nounSingular} not found`),
        },
      },
    },
  };
}

const componentReadPaths = {
  ...createComponentReadOperations({
    basePath: '/api/watchers',
    tag: 'Watchers',
    nounPlural: 'watchers',
    nounSingular: 'watcher',
    operationPrefix: 'watcher',
  }),
  ...createComponentReadOperations({
    basePath: '/api/registries',
    tag: 'Registries',
    nounPlural: 'registries',
    nounSingular: 'registry',
    operationPrefix: 'registry',
  }),
  ...createComponentReadOperations({
    basePath: '/api/authentications',
    tag: 'Authentications',
    nounPlural: 'authentications',
    nounSingular: 'authentication',
    operationPrefix: 'authentication',
  }),
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Drydock API',
    version: getVersion(),
    description:
      'Machine-readable API specification for Drydock. Canonical API base path is /api/v1, with /api available as a compatibility alias. Authentication defaults to session cookie auth. Mutating requests using session auth must also satisfy same-origin CSRF checks.',
  },
  servers: [
    {
      url: '/',
      description: 'Current Drydock server',
    },
  ],
  tags: [
    { name: 'System', description: 'Health, metadata, and server endpoints' },
    { name: 'Authentication', description: 'Authentication and session lifecycle endpoints' },
    { name: 'Containers', description: 'Container inventory and container-scoped operations' },
    { name: 'Triggers', description: 'Trigger discovery and trigger execution' },
    { name: 'Watchers', description: 'Watcher component discovery' },
    { name: 'Registries', description: 'Registry component discovery' },
    { name: 'Authentications', description: 'Authentication component discovery' },
    { name: 'Agents', description: 'Remote agent status and logs' },
    { name: 'Notifications', description: 'Notification rule management' },
    { name: 'Audit', description: 'Audit log endpoints' },
    { name: 'Logs', description: 'Application and container logs' },
    { name: 'Icons', description: 'Icon proxy/cache endpoints' },
    { name: 'Realtime', description: 'SSE stream and acknowledgements' },
    { name: 'Webhook', description: 'Token-authenticated webhook endpoints' },
    { name: 'Metrics', description: 'Prometheus metrics endpoint' },
    { name: 'Docs', description: 'API documentation endpoints' },
  ],
  security: [{ sessionAuth: [] }],
  components: {
    securitySchemes: {
      sessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description:
          'Session cookie authentication. For unsafe methods, requests must also satisfy same-origin CSRF validation (Origin/Referer/Sec-Fetch-Site checks).',
      },
      webhookBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        description:
          'Bearer token configured via webhook settings (shared token or endpoint-specific webhook tokens).',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
          details: { ...genericObjectSchema },
        },
        required: ['error', 'code', 'message'],
        additionalProperties: true,
      },
      GenericObject: genericObjectSchema,
      GenericArray: genericArraySchema,
      PaginationLinks: {
        type: 'object',
        properties: {
          self: { type: 'string' },
          next: { type: 'string' },
        },
        required: ['self'],
        additionalProperties: false,
      },
      PaginatedResult: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { ...genericObjectSchema },
          },
          total: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 0 },
          offset: { type: 'integer', minimum: 0 },
          hasMore: { type: 'boolean' },
          _links: { $ref: '#/components/schemas/PaginationLinks' },
        },
        required: ['data', 'total', 'limit', 'offset', 'hasMore'],
        additionalProperties: true,
      },
      CollectionResult: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { ...genericObjectSchema },
          },
          total: { type: 'integer', minimum: 0 },
        },
        required: ['data', 'total'],
        additionalProperties: true,
      },
      ActionResult: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          result: {},
        },
        required: ['message', 'result'],
        additionalProperties: true,
      },
      EmptyObject: emptyObjectSchema,
      HealthResponse: {
        type: 'object',
        properties: {
          uptime: { type: 'number' },
          message: { type: 'string' },
          timestamp: { type: 'number' },
        },
        required: ['message'],
        additionalProperties: true,
      },
      AppInfo: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['name', 'version'],
        additionalProperties: true,
      },
      WebhookWatchAllResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          watchers: { type: 'integer', minimum: 0 },
        },
        required: ['message', 'watchers'],
        additionalProperties: true,
      },
      WebhookContainerActionResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          container: { type: 'string' },
        },
        required: ['message', 'container'],
        additionalProperties: true,
      },
      AuthUser: {
        type: 'object',
        properties: {
          username: { type: 'string' },
        },
        required: ['username'],
        additionalProperties: true,
      },
      RememberMeResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      LogoutResponse: {
        type: 'object',
        properties: {
          logoutUrl: { type: 'string' },
        },
        additionalProperties: false,
      },
      SelfUpdateAckResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['accepted', 'ignored', 'rejected'] },
          operationId: { type: 'string' },
          reason: { type: 'string' },
          ackedClients: { type: 'integer', minimum: 0 },
          clientsAtEmit: { type: 'integer', minimum: 0 },
        },
        required: ['status', 'operationId'],
        additionalProperties: false,
      },
      LogSettings: {
        type: 'object',
        properties: {
          level: { type: 'string' },
        },
        required: ['level'],
        additionalProperties: true,
      },
      StoreConfigurationResponse: {
        type: 'object',
        properties: {
          configuration: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              file: { type: 'string' },
            },
            required: ['path', 'file'],
            additionalProperties: true,
          },
        },
        required: ['configuration'],
        additionalProperties: true,
      },
      LegacyInputSourceSummary: {
        type: 'object',
        properties: {
          total: { type: 'integer', minimum: 0 },
          keys: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['total', 'keys'],
        additionalProperties: false,
      },
      LegacyInputSummary: {
        type: 'object',
        properties: {
          total: { type: 'integer', minimum: 0 },
          env: { $ref: '#/components/schemas/LegacyInputSourceSummary' },
          label: { $ref: '#/components/schemas/LegacyInputSourceSummary' },
        },
        required: ['total', 'env', 'label'],
        additionalProperties: false,
      },
      ServerInfoResponse: {
        type: 'object',
        properties: {
          configuration: {
            type: 'object',
            properties: {
              webhook: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                },
                required: ['enabled'],
                additionalProperties: true,
              },
            },
            required: ['webhook'],
            additionalProperties: true,
          },
          compatibility: {
            type: 'object',
            properties: {
              legacyInputs: { $ref: '#/components/schemas/LegacyInputSummary' },
            },
            required: ['legacyInputs'],
            additionalProperties: true,
          },
        },
        required: ['configuration', 'compatibility'],
        additionalProperties: true,
      },
      SecurityRuntimeToolStatus: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          command: { type: 'string' },
          commandAvailable: { type: ['boolean', 'null'] },
          status: { type: 'string', enum: ['ready', 'missing', 'disabled'] },
          message: { type: 'string' },
        },
        required: ['enabled', 'command', 'commandAvailable', 'status', 'message'],
        additionalProperties: true,
      },
      SecurityRuntimeStatusResponse: {
        type: 'object',
        properties: {
          checkedAt: { type: 'string', format: 'date-time' },
          ready: { type: 'boolean' },
          scanner: {
            type: 'object',
            allOf: [
              { $ref: '#/components/schemas/SecurityRuntimeToolStatus' },
              {
                type: 'object',
                properties: {
                  scanner: { type: 'string' },
                  server: { type: 'string' },
                },
                required: ['scanner', 'server'],
                additionalProperties: true,
              },
            ],
          },
          signature: { $ref: '#/components/schemas/SecurityRuntimeToolStatus' },
          sbom: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              formats: {
                type: 'array',
                items: { type: 'string', enum: ['spdx-json', 'cyclonedx-json'] },
              },
            },
            required: ['enabled', 'formats'],
            additionalProperties: true,
          },
          requirements: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['checkedAt', 'ready', 'scanner', 'signature', 'sbom', 'requirements'],
        additionalProperties: true,
      },
      ContainerSummaryResponse: {
        type: 'object',
        properties: {
          containers: {
            type: 'object',
            properties: {
              total: { type: 'integer', minimum: 0 },
              running: { type: 'integer', minimum: 0 },
              stopped: { type: 'integer', minimum: 0 },
            },
            required: ['total', 'running', 'stopped'],
            additionalProperties: false,
          },
          security: {
            type: 'object',
            properties: {
              issues: { type: 'integer', minimum: 0 },
            },
            required: ['issues'],
            additionalProperties: false,
          },
        },
        required: ['containers', 'security'],
        additionalProperties: false,
      },
      ContainerRecentStatusResponse: {
        type: 'object',
        properties: {
          statuses: {
            type: 'object',
            additionalProperties: {
              type: 'string',
              enum: ['updated', 'pending', 'failed'],
            },
          },
        },
        required: ['statuses'],
        additionalProperties: false,
      },
      ContainerResource: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string' },
          watcher: { type: 'string' },
          agent: { type: 'string' },
          updateAvailable: { type: 'boolean' },
          image: { ...genericObjectSchema },
        },
        required: ['id', 'name'],
        additionalProperties: true,
      },
      VulnerabilitySummary: {
        type: 'object',
        properties: {
          unknown: { type: 'integer', minimum: 0 },
          low: { type: 'integer', minimum: 0 },
          medium: { type: 'integer', minimum: 0 },
          high: { type: 'integer', minimum: 0 },
          critical: { type: 'integer', minimum: 0 },
        },
        required: ['unknown', 'low', 'medium', 'high', 'critical'],
        additionalProperties: false,
      },
      VulnerabilityScanResult: {
        type: 'object',
        properties: {
          scanner: { type: 'string' },
          image: { type: 'string' },
          scannedAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['not-scanned', 'passed', 'blocked', 'error'] },
          blockSeverities: {
            type: 'array',
            items: { type: 'string', enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          },
          blockingCount: { type: 'integer', minimum: 0 },
          summary: { $ref: '#/components/schemas/VulnerabilitySummary' },
          vulnerabilities: {
            type: 'array',
            items: { ...genericObjectSchema },
          },
          error: { type: 'string' },
        },
        required: ['status', 'blockSeverities', 'blockingCount', 'summary', 'vulnerabilities'],
        additionalProperties: true,
      },
      SbomDocumentResponse: {
        type: 'object',
        properties: {
          generator: { type: 'string' },
          image: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          format: { type: 'string', enum: ['spdx-json', 'cyclonedx-json'] },
          document: { ...genericObjectSchema },
          error: { type: 'string' },
        },
        required: ['generator', 'image', 'generatedAt', 'format', 'document'],
        additionalProperties: true,
      },
      ContainerEnvEntry: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          sensitive: { type: 'boolean' },
        },
        required: ['key', 'value', 'sensitive'],
        additionalProperties: false,
      },
      ContainerEnvResponse: {
        type: 'object',
        properties: {
          env: {
            type: 'array',
            items: { $ref: '#/components/schemas/ContainerEnvEntry' },
          },
        },
        required: ['env'],
        additionalProperties: false,
      },
      ContainerLogsResponse: {
        type: 'object',
        properties: {
          logs: { type: 'string' },
        },
        required: ['logs'],
        additionalProperties: true,
      },
      PreviewResponse: {
        type: 'object',
        properties: {
          containerName: { type: 'string' },
          currentImage: { type: 'string' },
          newImage: { type: 'string' },
          updateKind: { ...genericObjectSchema },
          isRunning: { type: 'boolean' },
          networks: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: true,
      },
      ImageBackup: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          containerId: { type: 'string' },
          containerName: { type: 'string' },
          imageName: { type: 'string' },
          imageTag: { type: 'string' },
          imageDigest: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          triggerName: { type: 'string' },
        },
        required: [
          'id',
          'containerId',
          'containerName',
          'imageName',
          'imageTag',
          'timestamp',
          'triggerName',
        ],
        additionalProperties: false,
      },
      ContainerRollbackResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          backup: { $ref: '#/components/schemas/ImageBackup' },
        },
        required: ['message', 'backup'],
        additionalProperties: true,
      },
      ContainerActionResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          container: { $ref: '#/components/schemas/ContainerResource' },
        },
        required: ['message'],
        additionalProperties: true,
      },
      ComponentItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
          configuration: { ...genericObjectSchema },
          agent: { type: 'string' },
        },
        required: ['id', 'type', 'name'],
        additionalProperties: true,
      },
      IconCacheClearResponse: {
        type: 'object',
        properties: {
          cleared: { type: 'integer', minimum: 0 },
        },
        required: ['cleared'],
        additionalProperties: false,
      },
      Settings: {
        type: 'object',
        properties: {
          internetlessMode: { type: 'boolean' },
        },
        required: ['internetlessMode'],
        additionalProperties: false,
      },
      NotificationRule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          triggers: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['id', 'name', 'description', 'enabled', 'triggers'],
        additionalProperties: false,
      },
    },
  },
  paths: {
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
  },
} as const;
