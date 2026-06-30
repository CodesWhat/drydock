import { errorResponse, jsonResponse } from '../common.js';

export const statsPaths = {
  '/api/v1/stats/summary': {
    get: {
      tags: ['Containers'],
      summary: 'Get fleet-wide resource metrics summary',
      operationId: 'getFleetStatsSummary',
      responses: {
        200: jsonResponse('Fleet stats summary', {
          $ref: '#/components/schemas/FleetStatsSummaryResponse',
        }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/v1/stats/summary/stream': {
    get: {
      tags: ['Containers'],
      summary: 'Stream live fleet resource metrics summary via SSE',
      operationId: 'streamFleetStatsSummary',
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
      },
    },
  },
} as const;
