import { errorResponse, genericObjectSchema, jsonResponse } from '../common.js';
import { configPaths } from './config.js';

const effectiveConfigurationSchema = {
  type: 'object',
  properties: {
    file: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        path: { type: 'string' },
        modifiedAt: { type: 'string' },
      },
      required: ['present'],
      additionalProperties: false,
    },
    sections: {
      type: 'object',
      description:
        'Keyed by every top-level DD_<SECTION>_* prefix present in the merged configuration, not a fixed list.',
      additionalProperties: { ...genericObjectSchema },
    },
    sources: {
      type: 'object',
      additionalProperties: { type: 'string', enum: ['env', 'file'] },
    },
    restartRequired: { type: 'array', items: { type: 'string' } },
  },
  required: ['file', 'sections', 'sources', 'restartRequired'],
  additionalProperties: false,
};

describe('configPaths', () => {
  test('/api/v1/config GET path is fully specified', () => {
    expect(configPaths['/api/v1/config']).toStrictEqual({
      get: {
        tags: ['System'],
        summary: 'Get the effective, redacted configuration',
        description:
          'Returns the merged env+file configuration (roadmap 7.1 slice 4), with every value carrying its source (env or file) and every secret redacted the same way "config export" redacts one. Session-only: never reachable with an API key, matching the debug dump and the container env reveal.',
        operationId: 'getEffectiveConfiguration',
        responses: {
          200: jsonResponse('Effective configuration', effectiveConfigurationSchema),
          401: errorResponse('Authentication required'),
          403: errorResponse('This route is not reachable with an API key'),
          429: errorResponse('Config read rate limit exceeded'),
          500: errorResponse('Unable to build the effective configuration'),
        },
      },
    });
  });

  test('/api/v1/config/{section} GET path is fully specified', () => {
    expect(configPaths['/api/v1/config/{section}']).toStrictEqual({
      get: {
        tags: ['System'],
        summary: 'Get one section of the effective, redacted configuration',
        description:
          'Same payload as one entry of GET /api/v1/config\'s "sections" map, scoped to a single section named by the path parameter.',
        operationId: 'getEffectiveConfigurationSection',
        parameters: [
          {
            name: 'section',
            in: 'path',
            required: true,
            description:
              'Configuration section name — any DD_<SECTION>_* prefix present in the merged configuration (e.g. server, watcher, registry, action, notification, auth, agent, store), not a fixed list',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: jsonResponse('Effective configuration section', { ...genericObjectSchema }),
          401: errorResponse('Authentication required'),
          403: errorResponse('This route is not reachable with an API key'),
          404: errorResponse('Unknown configuration section'),
          429: errorResponse('Config read rate limit exceeded'),
          500: errorResponse('Unable to build the effective configuration'),
        },
      },
    });
  });

  test('configPaths exports exactly two path entries', () => {
    expect(Object.keys(configPaths)).toStrictEqual(['/api/v1/config', '/api/v1/config/{section}']);
  });
});
