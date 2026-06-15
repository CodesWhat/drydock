import { errorResponse, jsonResponse, noContentResponse } from '../common.js';

const agentKeyRecord = {
  type: 'object',
  required: ['keyId', 'pubkey', 'label', 'createdAt', 'revokedAt'],
  properties: {
    keyId: {
      type: 'string',
      description: 'Derived key identifier: hex(SHA-256(raw32Bytes)[:8]) — 16 lowercase hex chars',
      pattern: '^[0-9a-f]{16}$',
    },
    pubkey: {
      type: 'string',
      description: 'Ed25519 public key encoded as standard base64 (44 chars)',
      minLength: 44,
      maxLength: 44,
    },
    label: {
      type: 'string',
      description: 'Human-readable name assigned by the operator',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'ISO-8601 UTC timestamp when the key was registered',
    },
    revokedAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'ISO-8601 UTC timestamp when the key was revoked, or null if still active',
    },
  },
  additionalProperties: false,
} as const;

const experimentalNote =
  'EXPERIMENTAL: only available when the server is started with DD_EXPERIMENTAL_PORTWING=true.';

const keyIdPathParam = {
  name: 'keyId',
  in: 'path',
  required: true,
  description: 'Key identifier — exactly 16 lowercase hex characters',
  schema: { type: 'string', pattern: '^[0-9a-f]{16}$' },
} as const;

export const portwingPaths = {
  '/api/v1/portwing/keys': {
    get: {
      tags: ['Portwing'],
      summary: 'List all registered edge-agent keys',
      operationId: 'listPortwingKeys',
      description: `Returns all keys — active and revoked. ${experimentalNote}`,
      responses: {
        200: jsonResponse('Array of agent key records', {
          type: 'array',
          items: agentKeyRecord,
        }),
        401: errorResponse('Authentication required'),
      },
    },
    post: {
      tags: ['Portwing'],
      summary: 'Register a new authorized edge-agent key',
      operationId: 'createPortwingKey',
      description: `Registers a new Ed25519 public key for edge agent authentication. ${experimentalNote}`,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['pubkeyBase64', 'label'],
              properties: {
                pubkeyBase64: {
                  type: 'string',
                  description:
                    'Ed25519 public key encoded as standard base64; must decode to exactly 32 bytes',
                },
                label: {
                  type: 'string',
                  description: 'Human-readable identifier for this key',
                },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        201: jsonResponse('Key registered', {
          type: 'object',
          required: ['keyId', 'label', 'createdAt'],
          properties: {
            keyId: {
              type: 'string',
              pattern: '^[0-9a-f]{16}$',
              description: 'Derived 16-char hex key identifier',
            },
            label: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          additionalProperties: false,
        }),
        400: errorResponse('Malformed request — invalid pubkeyBase64 or missing fields'),
        401: errorResponse('Authentication required'),
        409: errorResponse('An active key with this keyId already exists'),
      },
    },
  },
  '/api/v1/portwing/keys/{keyId}': {
    delete: {
      tags: ['Portwing'],
      summary: 'Revoke a registered edge-agent key',
      operationId: 'revokePortwingKey',
      description: `Revokes the key and disconnects any live WebSocket session authenticated with it. ${experimentalNote}`,
      parameters: [keyIdPathParam],
      responses: {
        204: noContentResponse,
        400: errorResponse('Invalid keyId format — must be exactly 16 lowercase hex characters'),
        401: errorResponse('Authentication required'),
        404: errorResponse('No active key found with the given keyId'),
      },
    },
  },
} as const;
