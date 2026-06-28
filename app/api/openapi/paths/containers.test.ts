import {
  containerIdPathParam,
  containerListQueryParams,
  destructiveConfirmationHeaderParam,
  errorResponse,
  jsonResponse,
  noContentResponse,
  paginationQueryParams,
  triggerAgentPathParam,
  triggerNamePathParam,
  triggerTypePathParam,
} from '../common.js';
import { containerPaths } from './containers.js';

describe('containerPaths', () => {
  test('CONTAINER_ACTION_TAGS constant: tags array contains Containers and Actions in order', () => {
    // Kills L16:31 ([] mutation) and L16:32 ("" mutation)
    // These tags appear on every path built with createContainerIdActionPost
    const startPath = containerPaths['/api/containers/{id}/start'];
    expect(startPath.post.tags).toStrictEqual(['Containers', 'Actions']);

    const stopPath = containerPaths['/api/containers/{id}/stop'];
    expect(stopPath.post.tags).toStrictEqual(['Containers', 'Actions']);

    const restartPath = containerPaths['/api/containers/{id}/restart'];
    expect(restartPath.post.tags).toStrictEqual(['Containers', 'Actions']);
  });

  test('createRuntimeContainerActionPath: builds correct post shape with auth/403/404/500 responses', () => {
    // Kills L74:21 ({} ObjectLiteral), L76:26, L77:26, L78:26 (StringLiterals)
    // These are the hardcoded error responses inside createRuntimeContainerActionPath
    const startPath = containerPaths['/api/containers/{id}/start'];
    expect(startPath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });

  test('createRuntimeContainerActionPath: stop container path has correct failure description', () => {
    const stopPath = containerPaths['/api/containers/{id}/stop'];
    expect(stopPath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });

  test('createRuntimeContainerActionPath: restart container path is fully specified', () => {
    const restartPath = containerPaths['/api/containers/{id}/restart'];
    expect(restartPath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });

  test('createRuntimeContainerActionPath: update path with additionalErrorResponses and 202 status', () => {
    // Tests that additionalErrorResponses are merged before the standard errors
    const updatePath = containerPaths['/api/containers/{id}/update'];
    expect(updatePath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
        summary: 'Update container to latest available image',
        operationId: 'updateContainer',
        parameters: [containerIdPathParam],
        responses: {
          202: jsonResponse('Container update accepted', {
            $ref: '#/components/schemas/ContainerUpdateAcceptedResponse',
          }),
          400: errorResponse('No update available for container'),
          409: errorResponse(
            'Container update already queued or in progress, blocked by security, or targeting a rollback container',
          ),
          401: errorResponse('Authentication required'),
          403: errorResponse('Container actions feature disabled'),
          404: errorResponse('Container or docker trigger not found'),
          500: errorResponse('Container update failed'),
        },
      },
    });
  });

  test('container groups path returns collection result', () => {
    expect(containerPaths['/api/containers/groups']).toStrictEqual({
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
    });
  });

  test('container list path includes query parameters', () => {
    expect(containerPaths['/api/containers']).toStrictEqual({
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
    });
  });

  test('delete container path has correct response codes and parameters', () => {
    expect(containerPaths['/api/containers/{id}']).toStrictEqual({
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
    });
  });

  test('container update-operations path includes id param and pagination', () => {
    expect(containerPaths['/api/containers/{id}/update-operations']).toStrictEqual({
      get: {
        tags: ['Containers'],
        summary: 'Get persisted update-operation history for a container',
        operationId: 'getContainerUpdateOperations',
        parameters: [containerIdPathParam, ...paginationQueryParams],
        responses: {
          200: jsonResponse('Update operations', { $ref: '#/components/schemas/CollectionResult' }),
          401: errorResponse('Authentication required'),
          404: errorResponse('Container not found'),
        },
      },
    });
  });

  test('container triggers path and run-trigger paths are fully specified', () => {
    expect(
      containerPaths['/api/containers/{id}/triggers/{triggerType}/{triggerName}'],
    ).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });

    expect(
      containerPaths['/api/containers/{id}/triggers/{triggerType}/{triggerName}/{triggerAgent}'],
    ).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });

  test('createContainerIdActionPost: env reveal path uses correct schema ref', () => {
    const envRevealPath = containerPaths['/api/containers/{id}/env/reveal'];
    expect(envRevealPath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });

  test('intermediate-release-notes path has correct parameters and response codes', () => {
    const path = containerPaths['/api/containers/{id}/intermediate-release-notes'];
    expect(path).toStrictEqual({
      get: {
        tags: ['Containers'],
        summary: 'Get intermediate release notes between two image tags',
        operationId: 'getContainerIntermediateReleaseNotes',
        parameters: [
          containerIdPathParam,
          {
            name: 'from',
            in: 'query',
            required: true,
            description: 'Current running tag (lower bound, exclusive)',
            schema: { type: 'string' },
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            description:
              "Update target tag; defaults to the container's pending update tag when omitted",
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: jsonResponse('Intermediate release notes', {
            type: 'object',
            properties: {
              releaseNotes: {
                type: 'array',
                items: { $ref: '#/components/schemas/ReleaseNotesResource' },
              },
              hiddenCount: {
                type: 'integer',
                minimum: 0,
              },
            },
            required: ['releaseNotes', 'hiddenCount'],
            additionalProperties: false,
          }),
          400: errorResponse("Query parameter 'from' is required"),
          401: errorResponse('Authentication required'),
          404: errorResponse('Container not found'),
          422: errorResponse('Cannot determine target tag'),
          500: errorResponse('Error retrieving intermediate release notes'),
        },
      },
    });
  });

  test('createContainerIdActionPost: scan path uses ContainerResource schema ref', () => {
    const scanPath = containerPaths['/api/containers/{id}/scan'];
    expect(scanPath).toStrictEqual({
      post: {
        tags: ['Containers', 'Actions'],
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
    });
  });
});
