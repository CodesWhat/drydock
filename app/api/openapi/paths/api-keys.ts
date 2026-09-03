import { destructiveConfirmationHeaderParam, errorResponse, jsonResponse } from '../common.js';

/**
 * Keyset paging, not the shared offset params.
 *
 * A key minted between two pages inserts at the head of a newest-first list,
 * so an offset walk skips whatever lands on the page boundary. The cursor is
 * an opaque position in the `createdAt` + `keyId` sort order; clients should
 * echo `nextCursor` back rather than construct one.
 */
const keysetQueryParams = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Max number of keys to return (1-200, default 50)',
    schema: { type: 'integer', minimum: 1, maximum: 200 },
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    description:
      "Opaque cursor from a previous response's nextCursor, matched byte for byte. Anything else — trailing characters, added padding, a re-spelling of the same value — is rejected with 400 rather than restarting the walk.",
    schema: { type: 'string' },
  },
];

const API_SCOPE_VALUES = [
  'read',
  'containers:watch',
  'containers:update',
  'triggers:test',
  'admin',
  'api-keys:manage',
] as const;

const scopeArraySchema = {
  type: 'array',
  description:
    '`admin` implies every other scope except `api-keys:manage`, which is only ever held outright.',
  items: { type: 'string', enum: API_SCOPE_VALUES },
} as const;

/**
 * The stored record as the API projects it. `secretHash` is absent by shape,
 * not by deletion, and the same is true of the schema.
 */
const apiKeyRecord = {
  type: 'object',
  required: [
    'keyId',
    'name',
    'displayPrefix',
    'scopes',
    'status',
    'createdAt',
    'createdBy',
    'parentKeyId',
    'expiresAt',
    'lastUsedAt',
    'revokedAt',
  ],
  properties: {
    keyId: {
      type: 'string',
      description: 'Key identifier — exactly 12 lowercase hex characters',
      pattern: '^[0-9a-f]{12}$',
    },
    name: { type: 'string', description: 'Operator-assigned name' },
    displayPrefix: {
      type: 'string',
      description:
        'Truncated `ddk_<keyId>…` form, safe to display and to log. Never the credential.',
    },
    scopes: scopeArraySchema,
    status: {
      type: 'string',
      enum: ['active', 'revoked', 'expired'],
      description: 'Derived at read time from revokedAt and expiresAt',
    },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: {
      type: 'string',
      description: '`user:<username>` for a session-minted key, `api-key:<keyId>` for a child key',
    },
    parentKeyId: {
      type: ['string', 'null'],
      pattern: '^[0-9a-f]{12}$',
      description:
        'The key that minted this one, or null when a human session did. A null parent never cascades.',
    },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
    revokedAt: { type: ['string', 'null'], format: 'date-time' },
    revokedBy: { type: 'string' },
    rateLimitMax: {
      type: 'integer',
      minimum: 1,
      description: 'Per-key request ceiling; the global API limit applies when absent',
    },
  },
  additionalProperties: false,
} as const;

const createdApiKey = {
  type: 'object',
  required: [...apiKeyRecord.required, 'apiKey'],
  properties: {
    ...apiKeyRecord.properties,
    apiKey: {
      type: 'string',
      description:
        'The full credential, `ddk_<keyId>_<secret>`. Returned here and nowhere else: only a digest is stored, so a lost credential can only be replaced by minting another key.',
      pattern: '^ddk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$',
    },
  },
  additionalProperties: false,
} as const;

const keyIdPathParam = {
  name: 'keyId',
  in: 'path',
  required: true,
  description: 'Key identifier — exactly 12 lowercase hex characters',
  schema: { type: 'string', pattern: '^[0-9a-f]{12}$' },
} as const;

const managementSecurity = [{ apiKeyBearerAuth: [] }, { sessionAuth: [] }] as const;

const ceilingNote =
  'When the caller is itself an API key, it may only grant scopes it holds and may not mint a key that outlives it. A session is not subject to either ceiling.';

export const apiKeyPaths = {
  '/api/v1/api-keys': {
    get: {
      tags: ['API Keys'],
      summary: 'List API keys',
      operationId: 'listApiKeys',
      description:
        'Returns every key — active, expired and revoked — newest first, paged on a cursor rather than an offset so a key minted mid-walk cannot displace one that has not been read yet. The stored digest is never returned; each entry carries a truncated displayPrefix instead.',
      security: managementSecurity,
      parameters: keysetQueryParams,
      responses: {
        200: jsonResponse('One page of API key records', {
          type: 'object',
          required: ['data', 'total', 'limit', 'hasMore', '_links'],
          properties: {
            data: { type: 'array', items: apiKeyRecord },
            total: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            hasMore: { type: 'boolean' },
            nextCursor: {
              type: 'string',
              description: 'Pass back as `cursor` for the next page. Absent when hasMore is false.',
            },
            _links: { $ref: '#/components/schemas/PaginationLinks' },
          },
          additionalProperties: false,
        }),
        400: errorResponse('The cursor was not one this API issued'),
        401: errorResponse('Authentication required'),
        403: errorResponse('The calling API key is missing the api-keys:manage scope'),
      },
    },
    post: {
      tags: ['API Keys'],
      summary: 'Create an API key',
      operationId: 'createApiKey',
      description: `Mints a key and returns the credential exactly once. ${ceilingNote}`,
      security: managementSecurity,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'scopes'],
              properties: {
                name: { type: 'string', description: 'Operator-assigned name' },
                scopes: scopeArraySchema,
                expiresAt: {
                  type: ['string', 'null'],
                  format: 'date-time',
                  description: 'ISO-8601 expiry, or null for a key that does not expire',
                },
                rateLimitMax: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Per-key request ceiling; the global API limit applies when omitted',
                },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        201: jsonResponse('Key created — the only response that carries the credential', {
          ...createdApiKey,
        }),
        400: errorResponse('Malformed request — unknown scope, missing name, or invalid expiry'),
        401: errorResponse('Authentication required'),
        403: errorResponse(
          'The calling API key is missing the api-keys:manage scope, or the request exceeds its scope or expiry ceiling',
        ),
      },
    },
  },
  '/api/v1/api-keys/{keyId}': {
    delete: {
      tags: ['API Keys'],
      summary: 'Revoke an API key',
      operationId: 'revokeApiKey',
      description:
        'Revokes the key and, transitively, every key it minted. A key may not revoke itself or the key that minted it, because either would let a compromised key cut the branch it is being hunted from.',
      security: managementSecurity,
      parameters: [keyIdPathParam, destructiveConfirmationHeaderParam('api-key-revoke')],
      responses: {
        200: jsonResponse('Key revoked, with the full cascade', {
          type: 'object',
          required: ['keyId', 'revokedKeyIds', 'cascadeCount'],
          properties: {
            keyId: { type: 'string', pattern: '^[0-9a-f]{12}$' },
            revokedKeyIds: {
              type: 'array',
              description: 'The revoked key followed by every descendant, in cascade order',
              items: { type: 'string', pattern: '^[0-9a-f]{12}$' },
            },
            cascadeCount: { type: 'integer', minimum: 1 },
          },
          additionalProperties: false,
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse(
          'The calling API key is missing the api-keys:manage scope, or is trying to revoke itself or its parent',
        ),
        404: errorResponse('No key found with the given keyId'),
      },
    },
  },
} as const;
