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
    required: ['uptime'],
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
  WebhookContainerUpdateAcceptedResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      operationId: { type: 'string' },
      result: {
        type: 'object',
        properties: {
          container: { type: 'string' },
        },
        required: ['container'],
        additionalProperties: false,
      },
    },
    required: ['message', 'operationId', 'result'],
    additionalProperties: false,
  },
  RegistryWebhookResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      result: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          referencesMatched: { type: 'integer', minimum: 0 },
          containersMatched: { type: 'integer', minimum: 0 },
          checksTriggered: { type: 'integer', minimum: 0 },
          checksFailed: { type: 'integer', minimum: 0 },
          watchersMissing: { type: 'integer', minimum: 0 },
        },
        required: [
          'provider',
          'referencesMatched',
          'containersMatched',
          'checksTriggered',
          'checksFailed',
          'watchersMissing',
        ],
        additionalProperties: false,
      },
    },
    required: ['message', 'result'],
    additionalProperties: false,
  },
  AuthUser: {
    type: 'object',
    properties: {
      username: { type: 'string' },
    },
    required: ['username'],
    additionalProperties: true,
  },
  AuthStatusResponse: {
    type: 'object',
    properties: {
      providers: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['provider', 'error'],
          additionalProperties: false,
        },
      },
    },
    required: ['providers', 'errors'],
    additionalProperties: false,
  },
  AuthStrategiesResponse: {
    type: 'object',
    properties: {
      strategies: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['strategies', 'warnings'],
    additionalProperties: false,
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
  OperationAcceptedResponse: {
    type: 'object',
    properties: {
      operationId: { type: 'string' },
    },
    required: ['operationId'],
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
      api: { $ref: '#/components/schemas/LegacyInputSourceSummary' },
    },
    required: ['total', 'env', 'label', 'api'],
    additionalProperties: false,
  },
  CurlHealthcheckOverrideCompatibility: {
    type: 'object',
    properties: {
      detected: { type: 'boolean' },
      commandPreview: { type: 'string' },
    },
    required: ['detected'],
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
          curlHealthcheckOverride: {
            $ref: '#/components/schemas/CurlHealthcheckOverrideCompatibility',
          },
        },
        required: ['legacyInputs', 'curlHealthcheckOverride'],
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
      hotUpdates: { type: 'integer', minimum: 0 },
      matureUpdates: { type: 'integer', minimum: 0 },
    },
    required: ['containers', 'security', 'hotUpdates', 'matureUpdates'],
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
      statusesByIdentity: {
        type: 'object',
        additionalProperties: {
          type: 'string',
          enum: ['updated', 'pending', 'failed'],
        },
      },
    },
    required: ['statuses', 'statusesByIdentity'],
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
      identityKey: { type: 'string' },
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
  ContainerUpdateAcceptedResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      operationId: { type: 'string' },
    },
    required: ['message', 'operationId'],
    additionalProperties: false,
  },
  ContainerBulkUpdateAcceptedItem: {
    type: 'object',
    properties: {
      containerId: { type: 'string' },
      containerName: { type: 'string' },
      operationId: { type: 'string' },
    },
    required: ['containerId', 'containerName', 'operationId'],
    additionalProperties: false,
  },
  ContainerBulkUpdateRejectedItem: {
    type: 'object',
    properties: {
      containerId: { type: 'string' },
      containerName: { type: 'string' },
      statusCode: { type: 'integer' },
      message: { type: 'string' },
    },
    required: ['containerId', 'containerName', 'statusCode', 'message'],
    additionalProperties: false,
  },
  ContainerBulkUpdateResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      accepted: {
        type: 'array',
        items: { $ref: '#/components/schemas/ContainerBulkUpdateAcceptedItem' },
      },
      rejected: {
        type: 'array',
        items: { $ref: '#/components/schemas/ContainerBulkUpdateRejectedItem' },
      },
    },
    required: ['message', 'accepted', 'rejected'],
    additionalProperties: false,
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
  FleetStatsSummaryRow: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      cpuPercent: { type: 'number', minimum: 0 },
      memoryUsageBytes: { type: 'number', minimum: 0 },
      memoryLimitBytes: { type: 'number', minimum: 0 },
      memoryPercent: { type: 'number', minimum: 0 },
    },
    required: ['id', 'name', 'cpuPercent', 'memoryUsageBytes', 'memoryLimitBytes', 'memoryPercent'],
    additionalProperties: false,
  },
  FleetStatsSummary: {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      watchedCount: { type: 'integer', minimum: 0 },
      avgCpuPercent: { type: 'number', minimum: 0 },
      totalMemoryUsageBytes: { type: 'number', minimum: 0 },
      totalMemoryLimitBytes: { type: 'number', minimum: 0 },
      totalMemoryPercent: { type: 'number', minimum: 0 },
      topCpu: {
        type: 'array',
        items: { $ref: '#/components/schemas/FleetStatsSummaryRow' },
      },
      topMemory: {
        type: 'array',
        items: { $ref: '#/components/schemas/FleetStatsSummaryRow' },
      },
    },
    required: [
      'timestamp',
      'watchedCount',
      'avgCpuPercent',
      'totalMemoryUsageBytes',
      'totalMemoryLimitBytes',
      'totalMemoryPercent',
      'topCpu',
      'topMemory',
    ],
    additionalProperties: false,
  },
  FleetStatsSummaryResponse: {
    type: 'object',
    properties: {
      data: { $ref: '#/components/schemas/FleetStatsSummary' },
    },
    required: ['data'],
    additionalProperties: false,
  },
  NotificationOutboxEntry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      eventName: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
      triggerId: { type: 'string' },
      containerId: { type: 'string' },
      attempts: { type: 'integer', minimum: 0 },
      maxAttempts: { type: 'integer', minimum: 0 },
      nextAttemptAt: { type: 'string', format: 'date-time' },
      status: {
        type: 'string',
        enum: ['pending', 'delivered', 'dead-letter'],
      },
      lastError: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      deliveredAt: { type: 'string', format: 'date-time' },
      failedAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'eventName',
      'payload',
      'triggerId',
      'attempts',
      'maxAttempts',
      'nextAttemptAt',
      'status',
      'createdAt',
    ],
    additionalProperties: false,
  },
  NotificationOutboxResult: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/NotificationOutboxEntry' },
      },
      total: { type: 'integer', minimum: 0 },
      counts: {
        type: 'object',
        properties: {
          pending: { type: 'integer', minimum: 0 },
          delivered: { type: 'integer', minimum: 0 },
          deadLetter: { type: 'integer', minimum: 0 },
        },
        required: ['pending', 'delivered', 'deadLetter'],
        additionalProperties: false,
      },
    },
    required: ['data', 'total', 'counts'],
    additionalProperties: false,
  },
  UpdateOperation: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'in-progress', 'succeeded', 'failed', 'rolled-back', 'expired'],
      },
      phase: { type: 'string' },
      kind: { type: 'string' },
      containerName: { type: 'string' },
      containerId: { type: 'string' },
      triggerName: { type: 'string' },
      batchId: { type: 'string' },
      queuePosition: { type: 'integer', minimum: 0 },
      queueTotal: { type: 'integer', minimum: 0 },
      oldContainerId: { type: 'string' },
      oldName: { type: 'string' },
      tempName: { type: 'string' },
      oldContainerWasRunning: { type: 'boolean' },
      oldContainerStopped: { type: 'boolean' },
      newContainerId: { type: 'string' },
      fromVersion: { type: 'string' },
      toVersion: { type: 'string' },
      targetImage: { type: 'string' },
      rollbackReason: { type: 'string' },
      lastError: { type: 'string' },
      recoveredAt: { type: 'string', format: 'date-time' },
      completedAt: { type: 'string', format: 'date-time' },
      cancelRequested: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'status', 'phase', 'containerName', 'createdAt', 'updatedAt'],
    additionalProperties: true,
  },
} as const;
