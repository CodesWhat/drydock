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

  const configSectionPathParam = {
    name: 'section',
    in: 'path',
    required: true,
    description:
      'Configuration section name — any DD_<SECTION>_* prefix present in the merged configuration (e.g. server, watcher, registry, action, notification, auth, agent, store), not a fixed list',
    schema: { type: 'string' },
  };

  const configurationValidationErrorSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Dot-separated YAML path' },
      envKey: {
        type: 'string',
        description: 'The DD_*-prefixed env key the same value would carry',
      },
      message: { type: 'string' },
    },
    required: ['path', 'envKey', 'message'],
    additionalProperties: false,
  };

  const reconcileSummarySchema = {
    type: 'object',
    description:
      'Present only when `applied` is true — the component reconciliation outcome for this reload (roadmap 7.1 slice 6), counted rather than named: how many components were added, changed, removed, left unchanged, or errored while being reconciled to the new configuration.',
    properties: {
      added: { type: 'integer' },
      changed: { type: 'integer' },
      removed: { type: 'integer' },
      unchanged: { type: 'integer' },
      errors: { type: 'integer' },
    },
    required: ['added', 'changed', 'removed', 'unchanged', 'errors'],
    additionalProperties: false,
  };

  const orphanedNotificationRuleReferenceSchema = {
    type: 'object',
    description:
      'A DB notification rule whose trigger reference no longer resolves after this reload (spec-7.1-config-file.md section 3/4.3) — the rule itself is never deleted or rewritten, only reported.',
    properties: {
      ruleId: { type: 'string' },
      triggerId: { type: 'string' },
    },
    required: ['ruleId', 'triggerId'],
    additionalProperties: false,
  };

  test('/api/v1/config/{section} GET and PUT paths are fully specified', () => {
    expect(configPaths['/api/v1/config/{section}']).toStrictEqual({
      get: {
        tags: ['System'],
        summary: 'Get one section of the effective, redacted configuration',
        description:
          'Same payload as one entry of GET /api/v1/config\'s "sections" map, scoped to a single section named by the path parameter.',
        operationId: 'getEffectiveConfigurationSection',
        parameters: [configSectionPathParam],
        responses: {
          200: jsonResponse('Effective configuration section', { ...genericObjectSchema }),
          401: errorResponse('Authentication required'),
          403: errorResponse('This route is not reachable with an API key'),
          404: errorResponse('Unknown configuration section'),
          429: errorResponse('Config read rate limit exceeded'),
          500: errorResponse('Unable to build the effective configuration'),
        },
      },
      put: {
        tags: ['System'],
        summary: 'Write a configuration section through the file',
        description:
          'Validates the candidate the same way /validate does, then mutates the parsed drydock.yml document in place — preserving comments and key order everywhere except the section being replaced — writes it atomically, and reloads (roadmap 7.1 slice 7, spec-7.1-config-file.md section 4.4). Refuses with 409 when a key the write would set is actually sourced from the environment (env still wins, so writing it would be a silent no-op) or when the section is DB-owned (see PATCH /api/v1/settings); refuses with 409 when no configuration file exists to write to. An invalid body is a 400 with the same path/envKey/message shape /validate and /reload use, and the file on disk is untouched.',
        operationId: 'writeConfigurationSection',
        parameters: [configSectionPathParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                ...genericObjectSchema,
                description:
                  'The section tree to write, the same shape one entry of GET /api/v1/config\'s "sections" map has.',
              },
            },
          },
        },
        responses: {
          200: jsonResponse('Write result', {
            type: 'object',
            properties: {
              applied: { type: 'boolean' },
              section: { type: 'string' },
              changedKeys: { type: 'array', items: { type: 'string' } },
              restartRequired: {
                type: 'boolean',
                description:
                  'True when this section only takes effect after a restart (spec-7.1-config-file.md section 4.3) — the file was still written.',
              },
              reload: {
                type: 'object',
                description:
                  'The reload this write triggers (roadmap 7.1 slice 6) — same engine, same shape.',
                properties: {
                  applied: { type: 'boolean' },
                  diff: {
                    type: 'object',
                    properties: {
                      changed: { type: 'array', items: { type: 'string' } },
                      reload: { type: 'array', items: { type: 'string' } },
                      restart: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['changed', 'reload', 'restart'],
                    additionalProperties: false,
                  },
                  reconcile: { ...reconcileSummarySchema },
                  orphanedRules: {
                    type: 'array',
                    items: { ...orphanedNotificationRuleReferenceSchema },
                  },
                },
                required: ['applied', 'diff'],
                additionalProperties: false,
              },
            },
            required: ['applied', 'section', 'changedKeys', 'restartRequired', 'reload'],
            additionalProperties: false,
          }),
          400: jsonResponse('Invalid candidate section', {
            type: 'object',
            properties: {
              errors: { type: 'array', items: { ...configurationValidationErrorSchema } },
            },
            required: ['errors'],
            additionalProperties: false,
          }),
          401: errorResponse('Authentication required'),
          403: errorResponse('API key is missing the required scope'),
          409: errorResponse(
            'No configuration file exists, a key in this section is sourced from the environment, or this section is DB-owned',
          ),
          413: errorResponse(
            'Payload exceeds the global 256kb request body limit applied to all mutating /api/v1/* routes (app/api/api.ts) — no per-route override exists for this endpoint',
          ),
          429: errorResponse('Config write rate limit exceeded'),
          500: errorResponse('Unable to write the configuration section'),
        },
      },
    });
  });

  test('/api/v1/config/validate POST path is fully specified', () => {
    expect(configPaths['/api/v1/config/validate']).toStrictEqual({
      post: {
        tags: ['System'],
        summary: 'Validate a candidate configuration without applying it',
        description:
          'Runs the candidate document through the same flatten/interpolate/validate path real startup and "config validate" use (roadmap 7.1 slice 5), merged beneath the real environment (env still wins). Touches no disk, applies nothing, and constructs no component beyond schema validation.',
        operationId: 'validateCandidateConfiguration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Either { "yaml": "<document text>" } or the configuration tree itself, the same shape yaml.parse() would produce.',
                properties: {
                  yaml: { type: 'string', description: 'Raw drydock.yml document text' },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          200: jsonResponse('Validation result', {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'Dot-separated YAML path' },
                    envKey: {
                      type: 'string',
                      description: 'The DD_*-prefixed env key the same value would carry',
                    },
                    message: { type: 'string' },
                  },
                  required: ['path', 'envKey', 'message'],
                  additionalProperties: false,
                },
              },
              diff: {
                type: 'object',
                description:
                  'Keys that would change if this candidate replaced the current file layer, and which sections that implies would reload versus need a restart (spec-7.1-config-file.md section 4.3).',
                properties: {
                  changed: { type: 'array', items: { type: 'string' } },
                  reload: { type: 'array', items: { type: 'string' } },
                  restart: { type: 'array', items: { type: 'string' } },
                },
                required: ['changed', 'reload', 'restart'],
                additionalProperties: false,
              },
            },
            required: ['valid', 'errors', 'diff'],
            additionalProperties: false,
          }),
          401: errorResponse('Authentication required'),
          403: errorResponse('API key is missing the required scope'),
          413: errorResponse(
            'Payload exceeds the global 256kb request body limit applied to all mutating /api/v1/* routes (app/api/api.ts) — no per-route override exists for this endpoint',
          ),
          429: errorResponse('Config validate rate limit exceeded'),
          500: errorResponse('Unable to validate the candidate configuration'),
        },
      },
    });
  });

  test('/api/v1/config/reload POST path is fully specified', () => {
    expect(configPaths['/api/v1/config/reload']).toStrictEqual({
      post: {
        tags: ['System'],
        summary: 'Re-read the configuration file and reconcile components against it',
        description:
          'Re-reads drydock.yml, validates the merged result exactly like /validate, and — only on success — reconciles registered components by difference against the new desired state (roadmap 7.1 slice 6, spec-7.1-config-file.md section 4.3). A restart-only key (server port, store path, log settings, and other module-load-read values) is reported in diff.restart but never applied; refuses the whole reload on any validation error, applying nothing.',
        operationId: 'reloadEffectiveConfiguration',
        responses: {
          200: jsonResponse('Reload result', {
            type: 'object',
            properties: {
              applied: { type: 'boolean' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'Dot-separated YAML path' },
                    envKey: {
                      type: 'string',
                      description: 'The DD_*-prefixed env key the same value would carry',
                    },
                    message: { type: 'string' },
                  },
                  required: ['path', 'envKey', 'message'],
                  additionalProperties: false,
                },
              },
              diff: {
                type: 'object',
                description:
                  'Keys that changed between the previous and newly re-read file, and which sections that implies reloaded versus need a restart (spec-7.1-config-file.md section 4.3).',
                properties: {
                  changed: { type: 'array', items: { type: 'string' } },
                  reload: { type: 'array', items: { type: 'string' } },
                  restart: { type: 'array', items: { type: 'string' } },
                },
                required: ['changed', 'reload', 'restart'],
                additionalProperties: false,
              },
              reconcile: {
                type: 'object',
                description:
                  'Present only when `applied` is true — the component reconciliation outcome for this reload (roadmap 7.1 slice 6), counted rather than named: how many components were added, changed, removed, left unchanged, or errored while being reconciled to the new configuration.',
                properties: {
                  added: { type: 'integer' },
                  changed: { type: 'integer' },
                  removed: { type: 'integer' },
                  unchanged: { type: 'integer' },
                  errors: { type: 'integer' },
                },
                required: ['added', 'changed', 'removed', 'unchanged', 'errors'],
                additionalProperties: false,
              },
              orphanedRules: {
                type: 'array',
                description:
                  'Present only when `applied` is true — every notification rule reference left orphaned by this reload (a trigger it named was renamed or removed).',
                items: {
                  type: 'object',
                  description:
                    'A DB notification rule whose trigger reference no longer resolves after this reload (spec-7.1-config-file.md section 3/4.3) — the rule itself is never deleted or rewritten, only reported.',
                  properties: {
                    ruleId: { type: 'string' },
                    triggerId: { type: 'string' },
                  },
                  required: ['ruleId', 'triggerId'],
                  additionalProperties: false,
                },
              },
            },
            required: ['applied', 'errors', 'diff'],
            additionalProperties: false,
          }),
          401: errorResponse('Authentication required'),
          403: errorResponse('API key is missing the required scope'),
          429: errorResponse('Config reload rate limit exceeded'),
          500: errorResponse('Unable to reload the configuration'),
        },
      },
    });
  });

  test('configPaths exports exactly four path entries', () => {
    expect(Object.keys(configPaths)).toStrictEqual([
      '/api/v1/config',
      '/api/v1/config/{section}',
      '/api/v1/config/validate',
      '/api/v1/config/reload',
    ]);
  });
});
