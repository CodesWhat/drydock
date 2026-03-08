import { errorResponse, jsonResponse } from '../common.js';

export const authPaths = {
  '/api/auth/methods': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies (legacy alias)',
      operationId: 'getAuthMethodsAlias',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/GenericArray',
        }),
      },
    },
  },
  '/auth/strategies': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies',
      operationId: 'getAuthStrategies',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/GenericArray',
        }),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Authenticate and create session',
      operationId: 'login',
      security: [],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                remember: { type: 'boolean' },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Authenticated user', { $ref: '#/components/schemas/AuthUser' }),
        401: errorResponse('Authentication failed'),
        423: errorResponse('Account temporarily locked after repeated failed logins'),
        500: errorResponse('Unable to establish session'),
      },
    },
  },
  '/auth/remember': {
    post: {
      tags: ['Authentication'],
      summary: 'Persist remember-me preference for current session',
      operationId: 'setRememberMe',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                remember: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Remember-me preference saved', {
          $ref: '#/components/schemas/RememberMeResponse',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Session is unavailable'),
      },
    },
  },
  '/auth/user': {
    get: {
      tags: ['Authentication'],
      summary: 'Get current authenticated user',
      operationId: 'getCurrentUser',
      responses: {
        200: jsonResponse('Current user', { $ref: '#/components/schemas/AuthUser' }),
        401: errorResponse('Authentication required'),
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Authentication'],
      summary: 'Logout current user',
      operationId: 'logout',
      responses: {
        200: jsonResponse('Logout response', { $ref: '#/components/schemas/LogoutResponse' }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Unable to clear session'),
      },
    },
  },
} as const;
