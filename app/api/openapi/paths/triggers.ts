import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
  paginationQueryParams,
} from '../common.js';

export const triggerPaths = {
  '/api/v1/triggers': {
    get: {
      tags: ['Triggers'],
      summary: 'List triggers',
      operationId: 'listTriggers',
      parameters: paginationQueryParams,
      responses: {
        200: jsonResponse('Triggers', { $ref: '#/components/schemas/PaginatedResult' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/api/v1/triggers/{type}/{name}': {
    get: {
      tags: ['Triggers'],
      summary: 'Get trigger by type and name',
      operationId: 'getTriggerByTypeAndName',
      parameters: [componentTypePathParam, componentNamePathParam],
      responses: {
        200: jsonResponse('Trigger details', { $ref: '#/components/schemas/ComponentItem' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
    post: {
      tags: ['Triggers', 'Actions'],
      summary: 'Run trigger for a provided container payload',
      operationId: 'runTrigger',
      parameters: [componentTypePathParam, componentNamePathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Container payload used by trigger implementation',
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        202: jsonResponse('Update operation accepted', {
          $ref: '#/components/schemas/OperationAcceptedResponse',
        }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
        409: errorResponse('Update cannot be queued'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
  '/api/v1/triggers/{type}/{name}/skips': {
    get: {
      tags: ['Triggers'],
      summary: 'List recent notification skips for a trigger',
      operationId: 'getTriggerSkips',
      description:
        'The most recent skip per container for one notification trigger, newest first (DR-85). ' +
        'Held in memory, so it is cleared when a notification is sent and lost on restart.',
      parameters: [componentTypePathParam, componentNamePathParam, ...paginationQueryParams],
      responses: {
        200: jsonResponse('Trigger skips', { $ref: '#/components/schemas/TriggerSkipsResult' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
  },
  '/api/v1/triggers/{type}/{name}/{agent}/skips': {
    get: {
      tags: ['Triggers'],
      summary: 'List recent notification skips for a remote trigger',
      operationId: 'getRemoteTriggerSkips',
      parameters: [
        componentTypePathParam,
        componentNamePathParam,
        componentAgentPathParam,
        ...paginationQueryParams,
      ],
      responses: {
        200: jsonResponse('Trigger skips', { $ref: '#/components/schemas/TriggerSkipsResult' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
  },
  '/api/v1/triggers/{type}/{name}/{agent}': {
    get: {
      tags: ['Triggers'],
      summary: 'Get remote trigger by type, name, and agent',
      operationId: 'getTriggerByTypeAndNameAndAgent',
      parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
      responses: {
        200: jsonResponse('Trigger details', { $ref: '#/components/schemas/ComponentItem' }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Trigger not found'),
      },
    },
    post: {
      tags: ['Triggers', 'Actions'],
      summary: 'Run remote trigger for a provided container payload',
      operationId: 'runRemoteTrigger',
      parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        202: jsonResponse('Update operation accepted', {
          $ref: '#/components/schemas/OperationAcceptedResponse',
        }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Agent not found'),
        409: errorResponse('Update cannot be queued or route agent does not own container'),
        500: errorResponse('Trigger execution failed'),
      },
    },
  },
} as const;
