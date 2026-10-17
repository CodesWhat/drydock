import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
} from '../common.js';

const resultSchema = {
  type: 'object',
  required: ['context', 'containers', 'removedIds', 'errors', 'authoritative'],
  properties: {
    context: {
      type: 'object',
      required: ['origin', 'operationId', 'source'],
      properties: {
        origin: { const: 'inventory' },
        operationId: { type: 'string', format: 'uuid' },
        source: {
          type: 'object',
          required: ['type', 'name'],
          properties: {
            type: { const: 'docker' },
            name: { type: 'string' },
            agent: { type: 'string' },
          },
        },
      },
    },
    containers: { type: 'array', items: { $ref: '#/components/schemas/ContainerResource' } },
    removedIds: { type: 'array', items: { type: 'string' } },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['phase', 'message'],
        properties: {
          phase: {
            type: 'string',
            enum: [
              'store',
              'enumerate',
              'inspect',
              'labels',
              'image',
              'ownership',
              'stale',
              'persist',
            ],
          },
          id: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    authoritative: { type: 'boolean' },
  },
} as const;

function inventoryOperation(agent: boolean) {
  return {
    post: {
      tags: ['Watchers'],
      summary: 'Refresh Docker inventory without registry checks',
      description:
        'Requires containers:watch. An authoritative empty result is success. Degraded observations return 200 with authoritative=false and sanitized diagnostics; containers contains final source inventory, not only changed rows. No unsupported-provider fallback to a registry scan.',
      operationId: agent ? 'watcherInventoryRefreshAgent' : 'watcherInventoryRefresh',
      parameters: [
        componentTypePathParam,
        componentNamePathParam,
        ...(agent ? [componentAgentPathParam] : []),
      ],
      requestBody: {
        content: {
          'application/json': { schema: { type: 'object', additionalProperties: false } },
        },
      },
      responses: {
        200: jsonResponse(
          'Final source inventory, redacted for public API consumers',
          resultSchema,
        ),
        400: errorResponse('Request body must be empty'),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing containers:watch scope'),
        404: errorResponse('Watcher not found'),
        500: errorResponse('Inventory refresh failed'),
        501: errorResponse('Inventory refresh unsupported'),
        503: errorResponse('Agent disconnected'),
        504: errorResponse('Inventory refresh timed out'),
      },
    },
  };
}

export const watcherInventoryPaths = {
  '/api/v1/watchers/{type}/{name}/inventory': inventoryOperation(false),
  '/api/v1/watchers/{type}/{name}/{agent}/inventory': inventoryOperation(true),
};
