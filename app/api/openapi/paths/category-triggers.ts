import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
  paginationQueryParams,
} from '../common.js';

interface CategoryRouteConfig {
  base: string;
  tag: string;
  noun: string;
  opName: string;
  scope: string;
}

const runBody = {
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
} as const;

const remoteRunBody = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
        additionalProperties: true,
      },
    },
  },
} as const;

const runResponses = {
  200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
  202: jsonResponse('Update operation accepted', {
    $ref: '#/components/schemas/OperationAcceptedResponse',
  }),
  400: errorResponse('Invalid trigger request'),
  401: errorResponse('Authentication required'),
  404: errorResponse('Trigger not found'),
  409: errorResponse('Update cannot be queued or route agent does not own container'),
  500: errorResponse('Trigger execution failed'),
} as const;

function buildCategoryPaths({ base, tag, noun, opName, scope }: CategoryRouteConfig) {
  const note = `Same handler and response shape as the matching /api/v1/triggers route, restricted to ${scope}. Any other trigger type returns 404.`;
  return {
    [base]: {
      get: {
        tags: [tag],
        summary: `List ${noun}s`,
        description: note,
        operationId: `list${opName}s`,
        parameters: paginationQueryParams,
        responses: {
          200: jsonResponse(`${noun}s`, { $ref: '#/components/schemas/PaginatedResult' }),
          401: errorResponse('Authentication required'),
        },
      },
    },
    [`${base}/{type}/{name}`]: {
      get: {
        tags: [tag],
        summary: `Get ${noun} by type and name`,
        description: note,
        operationId: `get${opName}ByTypeAndName`,
        parameters: [componentTypePathParam, componentNamePathParam],
        responses: {
          200: jsonResponse(`${noun} details`, { $ref: '#/components/schemas/ComponentItem' }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${noun} not found`),
        },
      },
      post: {
        tags: [tag],
        summary: `Run ${noun} for a provided container payload`,
        description: note,
        operationId: `run${opName}ByTypeAndName`,
        parameters: [componentTypePathParam, componentNamePathParam],
        requestBody: runBody,
        responses: runResponses,
      },
    },
    [`${base}/{type}/{name}/{agent}`]: {
      get: {
        tags: [tag],
        summary: `Get remote ${noun} by type, name, and agent`,
        description: note,
        operationId: `get${opName}ByTypeAndNameAndAgent`,
        parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
        responses: {
          200: jsonResponse(`${noun} details`, { $ref: '#/components/schemas/ComponentItem' }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${noun} not found`),
        },
      },
      post: {
        tags: [tag],
        summary: `Run remote ${noun} for a provided container payload`,
        description: note,
        operationId: `run${opName}ByTypeAndNameAndAgent`,
        parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
        requestBody: remoteRunBody,
        responses: runResponses,
      },
    },
  };
}

export const categoryTriggerPaths = {
  ...buildCategoryPaths({
    base: '/api/v1/actions',
    tag: 'Actions',
    noun: 'action',
    opName: 'Action',
    scope: 'action triggers (docker, dockercompose, command)',
  }),
  ...buildCategoryPaths({
    base: '/api/v1/notification-triggers',
    tag: 'Notification Triggers',
    noun: 'notification trigger',
    opName: 'NotificationTrigger',
    scope: 'notification triggers (every provider that is not an action)',
  }),
};
