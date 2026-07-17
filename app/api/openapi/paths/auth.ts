import { errorResponse, jsonResponse } from '../common.js';

export const authPaths = {
  '/api/v1/auth/status': {
    get: {
      tags: ['Authentication'],
      summary: 'Get authentication provider registration status',
      operationId: 'getAuthStatus',
      security: [],
      responses: {
        200: jsonResponse('Authentication provider status', {
          $ref: '#/components/schemas/AuthStatusResponse',
        }),
      },
    },
  },
  '/api/auth/status': {
    get: {
      tags: ['Authentication'],
      summary: 'Get authentication provider registration status (compatibility alias)',
      operationId: 'getAuthStatusApiAlias',
      security: [],
      responses: {
        200: jsonResponse('Authentication provider status', {
          $ref: '#/components/schemas/AuthStatusResponse',
        }),
      },
    },
  },
  '/api/auth/methods': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies (legacy alias)',
      operationId: 'getAuthMethodsAlias',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/AuthStrategiesResponse',
        }),
      },
    },
  },
  '/auth/status': {
    get: {
      tags: ['Authentication'],
      summary: 'Get authentication provider registration status (root auth route)',
      operationId: 'getAuthStatusRoot',
      security: [],
      responses: {
        200: jsonResponse('Authentication provider status', {
          $ref: '#/components/schemas/AuthStatusResponse',
        }),
      },
    },
  },
  '/auth/strategies': {
    get: {
      tags: ['Authentication'],
      summary: 'Get enabled authentication strategies (legacy response shape)',
      operationId: 'getAuthStrategies',
      security: [],
      responses: {
        200: jsonResponse('Authentication strategies', {
          $ref: '#/components/schemas/AuthStrategiesResponse',
        }),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Authentication', 'Actions'],
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
      tags: ['Authentication', 'Actions'],
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
      tags: ['Authentication', 'Actions'],
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
