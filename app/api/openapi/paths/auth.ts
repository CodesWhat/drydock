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
        202: {
          ...jsonResponse(
            'The password was right but the account has a second factor. No session was created; finish with PUT /auth/login-challenges/{id}.',
            { $ref: '#/components/schemas/LoginChallengeResponse' },
          ),
          headers: {
            Location: {
              description: 'Path of the login challenge',
              schema: { type: 'string' },
            },
          },
        },
        401: errorResponse('Authentication failed'),
        423: errorResponse('Account temporarily locked after repeated failed logins'),
        429: errorResponse('Too many concurrent logins or pending login challenges'),
        500: errorResponse('Unable to establish session'),
      },
    },
  },
  '/auth/login-challenges/{id}': {
    put: {
      tags: ['Authentication', 'Actions'],
      summary: 'Complete a login with a second factor',
      operationId: 'completeLoginChallenge',
      security: [],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Challenge id from the 202 login response; valid for five minutes',
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginChallengeCompletion' },
          },
        },
      },
      responses: {
        200: jsonResponse('Authenticated user; a session was created', {
          $ref: '#/components/schemas/AuthUser',
        }),
        400: errorResponse('Body is not exactly a code or a recovery code, plus optional remember'),
        401: errorResponse('Unknown, expired, used or stale challenge, or a wrong or reused proof'),
        423: errorResponse('Account, address or second factor temporarily locked'),
        500: errorResponse('Unable to establish session'),
        503: errorResponse('Second factor verification is unavailable'),
      },
    },
    delete: {
      tags: ['Authentication', 'Actions'],
      summary: 'Cancel a login challenge',
      operationId: 'cancelLoginChallenge',
      security: [],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Challenge id',
          schema: { type: 'string' },
        },
      ],
      responses: {
        204: { description: 'Idempotent: the same answer for an unknown or used challenge' },
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
