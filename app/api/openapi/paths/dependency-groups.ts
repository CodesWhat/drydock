import { errorResponse, jsonResponse } from '../common.js';

const rootIdPathParam = {
  name: 'rootId',
  in: 'path',
  required: true,
  description: 'Container identifier at the root of the dependency chain to update',
  schema: { type: 'string' },
} as const;

export const dependencyGroupPaths = {
  '/api/v1/dependency-groups/{rootId}/update': {
    post: {
      tags: ['Containers', 'Actions'],
      summary: 'Bulk-update every container in a dependency chain',
      description:
        'Updates every container in the weakly-connected dependency component rooted at :rootId, dispatched in dependency order. Mirrors the POST /containers/update {accepted, rejected} response shape, annotated with wave and actionKind per accepted entry.',
      operationId: 'updateDependencyGroup',
      parameters: [rootIdPathParam],
      responses: {
        200: jsonResponse('Dependency group update requests processed', {
          $ref: '#/components/schemas/DependencyGroupBulkUpdateResponse',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container not found'),
        500: errorResponse('Unable to accept dependency group update'),
      },
    },
  },
} as const;
