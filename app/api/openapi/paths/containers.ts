import {
  containerIdPathParam,
  containerListQueryParams,
  destructiveConfirmationHeaderParam,
  errorResponse,
  jsonResponse,
  noContentResponse,
  triggerAgentPathParam,
  triggerNamePathParam,
  triggerTypePathParam,
} from '../common.js';

export const containerPaths = {
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
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/WatchContainersRequest' },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated containers', { $ref: '#/components/schemas/PaginatedResult' }),
        400: errorResponse('Invalid watch request payload'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Container not found'),
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
  '/api/containers/security/vulnerabilities': {
    get: {
      tags: ['Containers'],
      summary: 'Get aggregated vulnerability data grouped by image',
      operationId: 'getContainerSecurityVulnerabilities',
      responses: {
        200: jsonResponse('Security vulnerability overview', {
          type: 'object',
          properties: {
            totalContainers: { type: 'integer', minimum: 0 },
            scannedContainers: { type: 'integer', minimum: 0 },
            latestScannedAt: { type: ['string', 'null'] },
            images: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  image: { type: 'string' },
                  containerIds: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  updateSummary: { $ref: '#/components/schemas/VulnerabilitySummary' },
                  vulnerabilities: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        severity: { type: 'string' },
                        package: { type: 'string' },
                        version: { type: 'string' },
                        fixedIn: { type: ['string', 'null'] },
                        title: { type: 'string' },
                        target: { type: 'string' },
                        primaryUrl: { type: 'string' },
                        publishedDate: { type: 'string' },
                      },
                      required: [
                        'id',
                        'severity',
                        'package',
                        'version',
                        'fixedIn',
                        'title',
                        'target',
                        'primaryUrl',
                        'publishedDate',
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['image', 'containerIds', 'vulnerabilities'],
                additionalProperties: false,
              },
            },
          },
          required: ['totalContainers', 'scannedContainers', 'latestScannedAt', 'images'],
          additionalProperties: false,
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
      parameters: [containerIdPathParam, destructiveConfirmationHeaderParam('container-delete')],
      responses: {
        204: noContentResponse,
        401: errorResponse('Authentication required'),
        428: errorResponse('Destructive confirmation header is required'),
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
        200: jsonResponse('Update operations', { $ref: '#/components/schemas/CollectionResult' }),
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
        200: jsonResponse('Container triggers', { $ref: '#/components/schemas/CollectionResult' }),
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
        200: jsonResponse('Container backups', { $ref: '#/components/schemas/CollectionResult' }),
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
      parameters: [containerIdPathParam, destructiveConfirmationHeaderParam('container-rollback')],
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
        428: errorResponse('Destructive confirmation header is required'),
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
} as const;
