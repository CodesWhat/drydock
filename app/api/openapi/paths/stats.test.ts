import { errorResponse, jsonResponse } from '../common.js';
import { statsPaths } from './stats.js';

describe('statsPaths', () => {
  test('/api/stats/summary GET path is fully specified', () => {
    expect(statsPaths['/api/stats/summary']).toStrictEqual({
      get: {
        tags: ['Containers'],
        summary: 'Get fleet-wide resource metrics summary',
        operationId: 'getFleetStatsSummary',
        responses: {
          200: jsonResponse('Fleet stats summary', {
            $ref: '#/components/schemas/FleetStatsSummary',
          }),
          401: errorResponse('Authentication required'),
        },
      },
    });
  });

  test('/api/stats/summary/stream GET path is fully specified', () => {
    expect(statsPaths['/api/stats/summary/stream']).toStrictEqual({
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
      '/api/stats/summary',
      '/api/stats/summary/stream',
    ]);
  });

  test('/api/stats/summary uses FleetStatsSummary $ref in 200 response', () => {
    const schema =
      statsPaths['/api/stats/summary'].get.responses[200].content?.['application/json']?.schema;
    expect(schema).toStrictEqual({ $ref: '#/components/schemas/FleetStatsSummary' });
  });

  test('/api/stats/summary/stream 200 uses text/event-stream content type', () => {
    const content = statsPaths['/api/stats/summary/stream'].get.responses[200].content;
    expect(content).toHaveProperty('text/event-stream');
    expect(content?.['text/event-stream']?.schema).toStrictEqual({ type: 'string' });
  });
});
