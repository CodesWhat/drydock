import { destructiveConfirmationHeaderParam, errorResponse, jsonResponse } from '../common.js';

const cleanupRunRequestBody = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          policy: { type: 'string', description: 'Name of a configured cleanup policy' },
          host: {
            type: 'string',
            description: 'Host id to run on; omit to run on every host the policy covers',
          },
          dryRun: {
            type: 'boolean',
            description: 'Report what would be removed without removing it',
          },
        },
        required: ['policy'],
        additionalProperties: false,
      },
    },
  },
} as const;

export const cleanupPaths = {
  '/api/v1/cleanup': {
    get: {
      tags: ['Images'],
      summary: 'List cleanup policies and the last result per policy and host',
      operationId: 'listCleanup',
      responses: {
        200: jsonResponse('Cleanup policies and last runs', {
          type: 'object',
          properties: {
            policies: { type: 'array', items: { type: 'object', additionalProperties: true } },
            lastRuns: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
          required: ['policies', 'lastRuns'],
          additionalProperties: false,
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/v1/cleanup/run': {
    post: {
      tags: ['Images', 'Actions'],
      summary: 'Run a cleanup policy now',
      description:
        'A dry run (`dryRun: true`) removes nothing and does not need the confirmation header. A run is skipped, with a reason on its result, when an update is in progress on the host.',
      operationId: 'runCleanup',
      parameters: [destructiveConfirmationHeaderParam('cleanup-run')],
      requestBody: cleanupRunRequestBody,
      responses: {
        200: jsonResponse('Cleanup results, one per host', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
          required: ['data'],
          additionalProperties: false,
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions are disabled'),
        404: errorResponse('Cleanup policy or host not found'),
        428: errorResponse('Destructive confirmation header is required'),
      },
    },
  },
} as const;
