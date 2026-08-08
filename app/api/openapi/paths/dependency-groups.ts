import { destructiveConfirmationHeaderParam, errorResponse, jsonResponse } from '../common.js';

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
        'Updates every container in the weakly-connected dependency component rooted at :rootId, dispatched in dependency order. Mirrors the POST /containers/update {accepted, rejected} response shape, annotated with wave and actionKind per accepted entry. Requires the destructive-confirmation header; optionally binds to a previously previewed container set via expectedContainerIds.',
      operationId: 'updateDependencyGroup',
      parameters: [rootIdPathParam, destructiveConfirmationHeaderParam('dependency-group-update')],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                expectedContainerIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Container ids the caller previously previewed (e.g. via update-chain-preview). If the live dependency chain no longer matches this set exactly, the request is rejected with 409 instead of running against a chain the caller never saw.',
                },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Dependency group update requests processed', {
          $ref: '#/components/schemas/DependencyGroupBulkUpdateResponse',
        }),
        400: errorResponse('expectedContainerIds must be an array of container ids'),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Container not found'),
        409: errorResponse('Dependency chain has changed since it was last previewed'),
        428: errorResponse('Destructive confirmation header is required'),
        500: errorResponse('Unable to accept dependency group update'),
      },
    },
  },
} as const;
