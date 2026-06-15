import { describe, expect, test } from 'vitest';
import { errorResponse, noContentResponse } from '../common.js';
import { portwingPaths } from './portwing.js';

describe('portwingPaths', () => {
  describe('/api/v1/portwing/keys GET', () => {
    const getPath = portwingPaths['/api/v1/portwing/keys'].get;

    test('has tag Portwing', () => {
      expect(getPath.tags).toStrictEqual(['Portwing']);
    });

    test('operationId is listPortwingKeys', () => {
      expect(getPath.operationId).toBe('listPortwingKeys');
    });

    test('summary is correct', () => {
      expect(getPath.summary).toBe('List all registered edge-agent keys');
    });

    test('description mentions EXPERIMENTAL and DD_EXPERIMENTAL_PORTWING=true', () => {
      expect(getPath.description).toContain('EXPERIMENTAL');
      expect(getPath.description).toContain('DD_EXPERIMENTAL_PORTWING=true');
    });

    test('200 response is a json array', () => {
      const schema = getPath.responses[200].content?.['application/json']?.schema;
      expect(schema).toMatchObject({ type: 'array' });
    });

    test('200 items schema contains keyId, pubkey, label, createdAt, revokedAt', () => {
      const schema = getPath.responses[200].content?.['application/json']?.schema as {
        type: string;
        items: { properties: Record<string, unknown> };
      };
      expect(Object.keys(schema.items.properties)).toStrictEqual([
        'keyId',
        'pubkey',
        'label',
        'createdAt',
        'revokedAt',
      ]);
    });

    test('keyId schema has 16-char hex pattern', () => {
      const schema = getPath.responses[200].content?.['application/json']?.schema as {
        items: { properties: { keyId: { pattern: string } } };
      };
      expect(schema.items.properties.keyId.pattern).toBe('^[0-9a-f]{16}$');
    });

    test('revokedAt schema allows null (type array includes null)', () => {
      const schema = getPath.responses[200].content?.['application/json']?.schema as {
        items: { properties: { revokedAt: { type: unknown } } };
      };
      const revokedAtType = schema.items.properties.revokedAt.type;
      expect(Array.isArray(revokedAtType)).toBe(true);
      expect(revokedAtType).toContain('null');
    });

    test('401 response is authentication error', () => {
      expect(getPath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
    });
  });

  describe('/api/v1/portwing/keys POST', () => {
    const postPath = portwingPaths['/api/v1/portwing/keys'].post;

    test('has tag Portwing', () => {
      expect(postPath.tags).toStrictEqual(['Portwing']);
    });

    test('operationId is createPortwingKey', () => {
      expect(postPath.operationId).toBe('createPortwingKey');
    });

    test('summary is correct', () => {
      expect(postPath.summary).toBe('Register a new authorized edge-agent key');
    });

    test('description mentions EXPERIMENTAL and DD_EXPERIMENTAL_PORTWING=true', () => {
      expect(postPath.description).toContain('EXPERIMENTAL');
      expect(postPath.description).toContain('DD_EXPERIMENTAL_PORTWING=true');
    });

    test('request body requires pubkeyBase64 and label', () => {
      const schema = postPath.requestBody.content['application/json'].schema as {
        required: string[];
      };
      expect(schema.required).toStrictEqual(['pubkeyBase64', 'label']);
    });

    test('request body is required', () => {
      expect(postPath.requestBody.required).toBe(true);
    });

    test('request body schema has no additionalProperties', () => {
      const schema = postPath.requestBody.content['application/json'].schema as {
        additionalProperties: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    });

    test('201 response schema requires keyId, label, createdAt', () => {
      const schema = postPath.responses[201].content?.['application/json']?.schema as {
        required: string[];
      };
      expect(schema.required).toStrictEqual(['keyId', 'label', 'createdAt']);
    });

    test('201 keyId has hex pattern', () => {
      const schema = postPath.responses[201].content?.['application/json']?.schema as {
        properties: { keyId: { pattern: string } };
      };
      expect(schema.properties.keyId.pattern).toBe('^[0-9a-f]{16}$');
    });

    test('400 response is malformed error', () => {
      expect(postPath.responses[400]).toStrictEqual(
        errorResponse('Malformed request — invalid pubkeyBase64 or missing fields'),
      );
    });

    test('401 response is authentication error', () => {
      expect(postPath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
    });

    test('409 response is duplicate key error', () => {
      expect(postPath.responses[409]).toStrictEqual(
        errorResponse('An active key with this keyId already exists'),
      );
    });
  });

  describe('/api/v1/portwing/keys/{keyId} DELETE', () => {
    const deletePath = portwingPaths['/api/v1/portwing/keys/{keyId}'].delete;

    test('has tag Portwing', () => {
      expect(deletePath.tags).toStrictEqual(['Portwing']);
    });

    test('operationId is revokePortwingKey', () => {
      expect(deletePath.operationId).toBe('revokePortwingKey');
    });

    test('summary is correct', () => {
      expect(deletePath.summary).toBe('Revoke a registered edge-agent key');
    });

    test('description mentions EXPERIMENTAL and DD_EXPERIMENTAL_PORTWING=true', () => {
      expect(deletePath.description).toContain('EXPERIMENTAL');
      expect(deletePath.description).toContain('DD_EXPERIMENTAL_PORTWING=true');
    });

    test('keyId path param has correct name and pattern', () => {
      const param = deletePath.parameters[0];
      expect(param.name).toBe('keyId');
      expect(param.in).toBe('path');
      expect(param.required).toBe(true);
      expect(param.schema).toStrictEqual({ type: 'string', pattern: '^[0-9a-f]{16}$' });
    });

    test('204 response is noContentResponse', () => {
      expect(deletePath.responses[204]).toStrictEqual(noContentResponse);
    });

    test('400 response describes invalid format', () => {
      expect(deletePath.responses[400]).toStrictEqual(
        errorResponse('Invalid keyId format — must be exactly 16 lowercase hex characters'),
      );
    });

    test('401 response is authentication error', () => {
      expect(deletePath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
    });

    test('404 response describes missing active key', () => {
      expect(deletePath.responses[404]).toStrictEqual(
        errorResponse('No active key found with the given keyId'),
      );
    });
  });

  test('portwingPaths exports exactly the two expected path keys', () => {
    expect(Object.keys(portwingPaths)).toStrictEqual([
      '/api/v1/portwing/keys',
      '/api/v1/portwing/keys/{keyId}',
    ]);
  });

  test('GET /api/v1/portwing/keys 200 response uses jsonResponse helper shape', () => {
    const response = portwingPaths['/api/v1/portwing/keys'].get.responses[200];
    expect(response).toHaveProperty('description');
    expect(response).toHaveProperty('content');
    expect(response.content).toHaveProperty('application/json');
  });

  test('POST /api/v1/portwing/keys 201 response uses jsonResponse helper shape', () => {
    const response = portwingPaths['/api/v1/portwing/keys'].post.responses[201];
    expect(response).toHaveProperty('description');
    expect(response).toHaveProperty('content');
    expect(response.content).toHaveProperty('application/json');
  });

  test('full GET path matches expected shape', () => {
    const getPath = portwingPaths['/api/v1/portwing/keys'].get;
    expect(getPath).toMatchObject({
      tags: ['Portwing'],
      operationId: 'listPortwingKeys',
      responses: {
        401: errorResponse('Authentication required'),
      },
    });
  });

  test('full DELETE path matches expected shape', () => {
    const deletePath = portwingPaths['/api/v1/portwing/keys/{keyId}'].delete;
    expect(deletePath).toMatchObject({
      tags: ['Portwing'],
      operationId: 'revokePortwingKey',
      responses: {
        204: noContentResponse,
        401: errorResponse('Authentication required'),
        404: errorResponse('No active key found with the given keyId'),
      },
    });
  });
});
