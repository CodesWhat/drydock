import { errorResponse, jsonResponse } from '../common.js';

const policyIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Group policy identifier (the `id` field, not the group name)',
  schema: { type: 'string' },
} as const;

const revisionQueryParam = {
  name: 'revision',
  in: 'query',
  required: true,
  description: 'The revision the caller last read. A stale revision is rejected with 409.',
  schema: { type: 'integer', minimum: 1 },
} as const;

const updatePolicyRequestSchema = {
  $ref: '#/components/schemas/ContainerDeclarativeUpdatePolicy',
} as const;

const writeNote =
  'Writes are admin scoped because one write changes every current and future member of the group. A containers:update key keeps its per-container override power, which outranks group values, and cannot write group policies. The policy row and its audit entry commit in one transaction.';

const bodyNote =
  'Only `updatePolicy` is accepted: `maturityMode`, `maturityMinAgeDays`, `skipTags` and `skipDigests`, validated like the container label layer. An empty skip list is dropped. A policy that sets no field is rejected, so use DELETE instead. Unknown fields, including `actions`, are rejected with 400.';

export const groupPolicyPaths = {
  '/api/v1/group-policies': {
    get: {
      tags: ['Group policies'],
      summary: 'List group policies',
      operationId: 'listGroupPolicies',
      description:
        'Returns every policy ordered by group name, each with the containers currently in its group.',
      responses: {
        200: jsonResponse('Group policies', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/GroupPolicyWithMembers' } },
            total: { type: 'integer', minimum: 0 },
          },
          required: ['data', 'total'],
          additionalProperties: false,
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('API key is missing the required scope'),
        500: errorResponse('Internal server error'),
      },
    },
    post: {
      tags: ['Group policies'],
      summary: 'Create a group policy',
      operationId: 'createGroupPolicy',
      description: `Creates the policy for one exact group name at revision 1 and re-resolves every current member. Future members pick it up when they are written. ${bodyNote} ${writeNote}`,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                group: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'The exact group name, matched without trimming or case folding. Must not be only whitespace.',
                },
                updatePolicy: updatePolicyRequestSchema,
              },
              required: ['group', 'updatePolicy'],
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        201: jsonResponse('Policy created', {
          $ref: '#/components/schemas/GroupPolicyWriteResult',
        }),
        400: errorResponse('Invalid group policy payload'),
        401: errorResponse('Authentication required'),
        403: errorResponse('API key is missing the required scope'),
        409: errorResponse('A policy for this group already exists'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/group-policies/{id}': {
    get: {
      tags: ['Group policies'],
      summary: 'Get a group policy',
      operationId: 'getGroupPolicy',
      parameters: [policyIdPathParam],
      responses: {
        200: jsonResponse('Group policy with its current members', {
          $ref: '#/components/schemas/GroupPolicyWithMembers',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('API key is missing the required scope'),
        404: errorResponse('Group policy not found'),
        500: errorResponse('Internal server error'),
      },
    },
    put: {
      tags: ['Group policies'],
      summary: 'Replace a group policy',
      operationId: 'replaceGroupPolicy',
      description: `Full replace of the policy body, guarded by the revision. A body that equals the stored policy returns \`changed: false\` and writes nothing: no revision bump and no audit entry. ${bodyNote} ${writeNote}`,
      parameters: [policyIdPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                group: {
                  type: 'string',
                  description:
                    'Optional. The group is immutable, so a value that differs from the stored group is rejected with 400. Delete the policy and create one to retarget it.',
                },
                revision: { type: 'integer', minimum: 1 },
                updatePolicy: updatePolicyRequestSchema,
              },
              required: ['revision', 'updatePolicy'],
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Policy replaced, or unchanged', {
          $ref: '#/components/schemas/GroupPolicyWriteResult',
        }),
        400: errorResponse(
          'Invalid group policy payload, or the group differs from the stored one',
        ),
        401: errorResponse('Authentication required'),
        403: errorResponse('API key is missing the required scope'),
        404: errorResponse('Group policy not found'),
        409: errorResponse('The revision is stale: the policy changed since it was read'),
        500: errorResponse('Internal server error'),
      },
    },
    delete: {
      tags: ['Group policies'],
      summary: 'Delete a group policy',
      operationId: 'deleteGroupPolicy',
      description: `Deletes the policy and re-resolves its members, which fall back to label, watcher environment or built-in values. ${writeNote}`,
      parameters: [policyIdPathParam, revisionQueryParam],
      responses: {
        200: jsonResponse('Policy deleted', {
          $ref: '#/components/schemas/GroupPolicyWriteResult',
        }),
        400: errorResponse('The revision query parameter is missing or invalid'),
        401: errorResponse('Authentication required'),
        403: errorResponse('API key is missing the required scope'),
        404: errorResponse('Group policy not found'),
        409: errorResponse('The revision is stale: the policy changed since it was read'),
        500: errorResponse('Internal server error'),
      },
    },
  },
} as const;
