import { errorResponse, jsonResponse } from '../common.js';
import { statsPaths } from './stats.js';

describe('statsPaths', () => {
  test('/api/v1/stats/summary GET path is fully specified', () => {
    expect(statsPaths['/api/v1/stats/summary']).toStrictEqual({
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
    });
  });

  test('/api/v1/stats/summary/stream GET path is fully specified', () => {
    expect(statsPaths['/api/v1/stats/summary/stream']).toStrictEqual({
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
    });
  });

  test('statsPaths exports exactly two path entries', () => {
    expect(Object.keys(statsPaths)).toStrictEqual([
      '/api/v1/stats/summary',
      '/api/v1/stats/summary/stream',
    ]);
  });

  test('/api/v1/stats/summary uses wrapped FleetStatsSummaryResponse $ref in 200 response', () => {
    const schema =
      statsPaths['/api/v1/stats/summary'].get.responses[200].content?.['application/json']?.schema;
    expect(schema).toStrictEqual({ $ref: '#/components/schemas/FleetStatsSummaryResponse' });
  });

  test('/api/v1/stats/summary/stream 200 uses text/event-stream content type', () => {
    const content = statsPaths['/api/v1/stats/summary/stream'].get.responses[200].content;
    expect(content).toHaveProperty('text/event-stream');
    expect(content?.['text/event-stream']?.schema).toStrictEqual({ type: 'string' });
  });
});
