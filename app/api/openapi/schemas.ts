import { emptyObjectSchema, genericArraySchema, genericObjectSchema } from './common.js';

export const openApiSchemas = {
  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      details: { ...genericObjectSchema },
    },
    required: ['error'],
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
      result: {
        type: 'object',
        properties: {
          watchers: { type: 'integer', minimum: 0 },
        },
        required: ['watchers'],
        additionalProperties: false,
      },
    },
    required: ['message', 'result'],
    additionalProperties: true,
  },
  WebhookContainerActionResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      result: {
        type: 'object',
        properties: {
          container: { type: 'string' },
        },
        required: ['container'],
        additionalProperties: false,
      },
    },
    required: ['message', 'result'],
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
          updatesAvailable: { type: 'integer', minimum: 0 },
        },
        required: ['total', 'running', 'stopped', 'updatesAvailable'],
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
  WatchContainersRequest: {
    type: 'object',
    properties: {
      containerIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 200,
      },
    },
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
  ReleaseNotesResource: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      url: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time' },
      provider: { type: 'string', enum: ['github', 'gitlab', 'gitea'] },
    },
    required: ['title', 'body', 'url', 'publishedAt', 'provider'],
    additionalProperties: false,
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
  ContainerStatsSnapshot: {
    type: 'object',
    properties: {
      containerId: { type: 'string' },
      cpuPercent: { type: 'number', minimum: 0 },
      memoryUsageBytes: { type: 'number', minimum: 0 },
      memoryLimitBytes: { type: 'number', minimum: 0 },
      memoryPercent: { type: 'number', minimum: 0 },
      networkRxBytes: { type: 'number', minimum: 0 },
      networkTxBytes: { type: 'number', minimum: 0 },
      blockReadBytes: { type: 'number', minimum: 0 },
      blockWriteBytes: { type: 'number', minimum: 0 },
      timestamp: { type: 'string', format: 'date-time' },
    },
    required: [
      'containerId',
      'cpuPercent',
      'memoryUsageBytes',
      'memoryLimitBytes',
      'memoryPercent',
      'networkRxBytes',
      'networkTxBytes',
      'blockReadBytes',
      'blockWriteBytes',
      'timestamp',
    ],
    additionalProperties: false,
  },
  ContainerStatsResponse: {
    type: 'object',
    properties: {
      data: {
        anyOf: [{ $ref: '#/components/schemas/ContainerStatsSnapshot' }, { type: 'null' }],
      },
      history: {
        type: 'array',
        items: { $ref: '#/components/schemas/ContainerStatsSnapshot' },
      },
    },
    required: ['data', 'history'],
    additionalProperties: false,
  },
  ContainerStatsSummaryItem: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      status: { type: ['string', 'null'] },
      watcher: { type: 'string' },
      agent: { type: ['string', 'null'] },
      stats: {
        anyOf: [{ $ref: '#/components/schemas/ContainerStatsSnapshot' }, { type: 'null' }],
      },
    },
    required: ['id', 'name', 'status', 'watcher', 'agent', 'stats'],
    additionalProperties: false,
  },
  ContainerStatsSummaryResponse: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/ContainerStatsSummaryItem' },
      },
    },
    required: ['data'],
    additionalProperties: false,
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
      compose: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
          },
          service: { type: 'string' },
          mutation: {
            type: 'object',
            properties: {
              intent: { type: 'string' },
              dryRun: { type: 'boolean' },
              willWrite: { type: 'boolean' },
            },
            required: ['intent', 'dryRun', 'willWrite'],
            additionalProperties: false,
          },
          patch: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              format: { type: 'string' },
              diff: { type: 'string' },
            },
            required: ['path', 'format', 'diff'],
            additionalProperties: false,
          },
        },
        required: ['files', 'paths', 'service', 'mutation'],
        additionalProperties: false,
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
      result: { $ref: '#/components/schemas/ContainerResource' },
    },
    required: ['message', 'result'],
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
} as const;
