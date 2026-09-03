/**
 * Tests for the API key OpenAPI paths.
 *
 * Two of these are load-bearing rather than descriptive: the scope enum is
 * pinned against the live registry so the published contract cannot drift from
 * what the router enforces, and the whole module is searched for the stored
 * digest so no future field can document it into existence.
 */
import { API_SCOPES } from '../../route-scopes.js';
import { openApiDocument } from '../index.js';
import { apiKeyPaths } from './api-keys.js';

const listPath = apiKeyPaths['/api/v1/api-keys'].get;
const createPath = apiKeyPaths['/api/v1/api-keys'].post;
const revokePath = apiKeyPaths['/api/v1/api-keys/{keyId}'].delete;

function schemaOf(response: {
  content?: Record<string, { schema?: unknown }>;
}): Record<string, unknown> {
  return response.content?.['application/json']?.schema as Record<string, unknown>;
}

describe('apiKeyPaths', () => {
  test('exports exactly the three management operations', () => {
    expect(Object.keys(apiKeyPaths)).toStrictEqual([
      '/api/v1/api-keys',
      '/api/v1/api-keys/{keyId}',
    ]);
    expect(Object.keys(apiKeyPaths['/api/v1/api-keys'])).toStrictEqual(['get', 'post']);
    expect(Object.keys(apiKeyPaths['/api/v1/api-keys/{keyId}'])).toStrictEqual(['delete']);
  });

  test('documents no verb that edits an existing key', () => {
    // No-self-extension depends on there being nothing to PATCH; publishing one
    // would be the first sign that changed.
    const operations = Object.values(apiKeyPaths).flatMap((item) => Object.keys(item));
    expect(operations).not.toContain('patch');
    expect(operations).not.toContain('put');
  });

  test('never mentions the stored digest anywhere in the module', () => {
    expect(JSON.stringify(apiKeyPaths)).not.toContain('secretHash');
  });

  test('pins the scope enum to the live registry', () => {
    const enumerated = (
      listPath.responses[200].content['application/json'].schema.properties.data.items.properties
        .scopes as { items: { enum: readonly string[] } }
    ).items.enum;

    expect([...enumerated]).toStrictEqual([...API_SCOPES]);
  });

  test('offers both a key and a session as authentication', () => {
    for (const operation of [listPath, createPath, revokePath]) {
      expect(operation.security).toStrictEqual([{ apiKeyBearerAuth: [] }, { sessionAuth: [] }]);
    }
  });

  test('every operation documents a 403 for a key without the manage scope', () => {
    for (const operation of [listPath, createPath, revokePath]) {
      expect(operation.responses[403].description).toContain('api-keys:manage');
    }
  });
});

describe('GET /api/v1/api-keys', () => {
  test('is tagged and named for the API Keys group', () => {
    expect(listPath.tags).toStrictEqual(['API Keys']);
    expect(listPath.operationId).toBe('listApiKeys');
  });

  test('returns a keyset envelope with the shared links schema', () => {
    const schema = schemaOf(listPath.responses[200]) as {
      required: string[];
      properties: { _links: { $ref: string }; nextCursor: { type: string } };
    };
    // No offset: an offset walk drops a key minted between two pages.
    expect(schema.required).toStrictEqual(['data', 'total', 'limit', 'hasMore', '_links']);
    expect(schema.properties).not.toHaveProperty('offset');
    expect(schema.properties.nextCursor.type).toBe('string');
    expect(schema.properties._links.$ref).toBe('#/components/schemas/PaginationLinks');
  });

  test('takes a cursor rather than an offset, and documents the 400 for a bad one', () => {
    const parameterNames = (listPath.parameters as Array<{ name: string }>).map(
      (parameter) => parameter.name,
    );

    expect(parameterNames).toStrictEqual(['limit', 'cursor']);
    expect(listPath.responses).toHaveProperty('400');
  });

  test('closes the record shape, so a new stored field cannot leak through', () => {
    const items = (
      schemaOf(listPath.responses[200]) as {
        properties: { data: { items: { additionalProperties: boolean; required: string[] } } };
      }
    ).properties.data.items;

    expect(items.additionalProperties).toBe(false);
    expect(items.required).toStrictEqual([
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
    ]);
  });

  test('documents the derived status values', () => {
    const items = (
      schemaOf(listPath.responses[200]) as {
        properties: { data: { items: { properties: { status: { enum: string[] } } } } };
      }
    ).properties.data.items;

    expect(items.properties.status.enum).toStrictEqual(['active', 'revoked', 'expired']);
  });

  test('does not carry the credential on any response', () => {
    expect(JSON.stringify(listPath)).not.toContain('ddk_<keyId>_<secret>');
  });
});

describe('POST /api/v1/api-keys', () => {
  test('is tagged and named for the API Keys group', () => {
    expect(createPath.tags).toStrictEqual(['API Keys']);
    expect(createPath.operationId).toBe('createApiKey');
  });

  test('requires a name and a scope list, and rejects unknown body fields', () => {
    const schema = createPath.requestBody.content['application/json'].schema as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toStrictEqual(['name', 'scopes']);
    expect(schema.additionalProperties).toBe(false);
  });

  test('returns the credential on the 201 and documents that it is not repeatable', () => {
    const schema = schemaOf(createPath.responses[201]) as {
      required: string[];
      properties: { apiKey: { pattern: string; description: string } };
    };

    expect(schema.required).toContain('apiKey');
    expect(schema.properties.apiKey.pattern).toBe('^ddk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$');
    expect(schema.properties.apiKey.description).toContain('nowhere else');
  });

  test('documents both minting ceilings on the 403', () => {
    expect(createPath.responses[403].description).toContain('scope or expiry ceiling');
    expect(createPath.description).toContain('may not mint a key that outlives it');
  });

  test('documents that a session is exempt from the ceilings', () => {
    expect(createPath.description).toContain('A session is not subject to either ceiling');
  });
});

describe('DELETE /api/v1/api-keys/{keyId}', () => {
  test('is tagged and named for the API Keys group', () => {
    expect(revokePath.tags).toStrictEqual(['API Keys']);
    expect(revokePath.operationId).toBe('revokeApiKey');
  });

  test('requires the destructive-action confirmation header', () => {
    const header = revokePath.parameters[1] as {
      name: string;
      in: string;
      required: boolean;
      schema: { enum: string[] };
    };
    expect(header.name).toBe('X-DD-Confirm-Action');
    expect(header.in).toBe('header');
    expect(header.required).toBe(true);
    expect(header.schema.enum).toStrictEqual(['api-key-revoke']);
  });

  test('constrains keyId to the stored identifier shape', () => {
    const param = revokePath.parameters[0] as { name: string; schema: { pattern: string } };
    expect(param.name).toBe('keyId');
    expect(param.schema.pattern).toBe('^[0-9a-f]{12}$');
  });

  test('reports the whole cascade rather than just the named key', () => {
    const schema = schemaOf(revokePath.responses[200]) as { required: string[] };
    expect(schema.required).toStrictEqual(['keyId', 'revokedKeyIds', 'cascadeCount']);
  });

  test('documents the self and parent refusals on the 403', () => {
    expect(revokePath.responses[403].description).toContain('revoke itself or its parent');
  });

  test('documents a 404 for an unknown key', () => {
    expect(revokePath.responses[404].description).toBe('No key found with the given keyId');
  });
});

describe('assembled document', () => {
  test('composes the API key paths into the published document', () => {
    expect(openApiDocument.paths['/api/v1/api-keys']).toBe(apiKeyPaths['/api/v1/api-keys']);
    expect(openApiDocument.paths['/api/v1/api-keys/{keyId}']).toBe(
      apiKeyPaths['/api/v1/api-keys/{keyId}'],
    );
  });

  test('declares the bearer scheme the operations reference', () => {
    const scheme = openApiDocument.components.securitySchemes.apiKeyBearerAuth;
    expect(scheme).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'ddk' });
    expect(scheme.description).toContain('Bearer ddk_<keyId>_<secret>');
  });

  test('documents that a key never establishes a session', () => {
    // The DR-7 property, stated where an integrator reads it: no session means
    // no cookie, which is why the CSRF checks do not apply.
    const scheme = openApiDocument.components.securitySchemes.apiKeyBearerAuth;
    expect(scheme.description).toContain('never establishes a session');
    expect(scheme.description).toContain('session-only');
  });

  test('declares the API Keys tag the operations use', () => {
    const names = openApiDocument.tags.map((tag) => tag.name);
    expect(names).toContain('API Keys');
  });
});
