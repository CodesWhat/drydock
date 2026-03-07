import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openApiDocument } from './openapi.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js') as typeof import('ajv/dist/2020.js').default;

type MutableOpenApiDocument = {
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
};

const mutableOpenApiDocument = openApiDocument as unknown as MutableOpenApiDocument;
const originalPaths = structuredClone(mutableOpenApiDocument.paths);
const originalSchemas = structuredClone(mutableOpenApiDocument.components.schemas);

function setJsonContractSchema(
  schema: unknown,
  options: {
    path?: string;
    method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
    statusCode?: string;
    schemas?: Record<string, unknown>;
  } = {},
) {
  const path = options.path ?? '/contract';
  const method = options.method ?? 'get';
  const statusCode = options.statusCode ?? '200';

  mutableOpenApiDocument.paths = {
    [path]: {
      [method]: {
        responses: {
          [statusCode]: {
            content: {
              'application/json': {
                schema,
              },
            },
          },
        },
      },
    },
  };
  mutableOpenApiDocument.components.schemas = options.schemas ?? {};
}

beforeEach(() => {
  mutableOpenApiDocument.paths = structuredClone(originalPaths);
  mutableOpenApiDocument.components.schemas = structuredClone(originalSchemas);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateOpenApiJsonResponse', () => {
  test('returns descriptive errors for unknown path, operation, status, and missing json schema', () => {
    mutableOpenApiDocument.paths = {};

    const unknownPath = validateOpenApiJsonResponse({
      path: '/missing',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(unknownPath).toEqual({
      valid: false,
      errors: ['Unknown OpenAPI path: /missing'],
    });

    mutableOpenApiDocument.paths = {
      '/only-post': {
        post: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };

    const unknownOperation = validateOpenApiJsonResponse({
      path: '/only-post',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(unknownOperation).toEqual({
      valid: false,
      errors: ['Unknown operation: GET /only-post'],
    });

    setJsonContractSchema({ type: 'string' }, { statusCode: '201' });
    const unknownStatus = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(unknownStatus).toEqual({
      valid: false,
      errors: ['Unknown response status 200 for GET /contract'],
    });

    mutableOpenApiDocument.paths = {
      '/contract': {
        get: {
          responses: {
            '200': {
              content: {
                'text/plain': { schema: { type: 'string' } },
              },
            },
          },
        },
      },
    };
    const missingJsonSchema = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(missingJsonSchema).toEqual({
      valid: false,
      errors: ['No application/json schema for GET /contract 200'],
    });
  });

  test('validates refs, recursive refs, allOf, enums, and additionalProperties variants', () => {
    setJsonContractSchema({ $ref: 'https://example.com/schema' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: {},
      }),
    ).toEqual({
      valid: false,
      errors: ['$: unresolved schema reference https://example.com/schema'],
    });

    setJsonContractSchema(
      { $ref: '#/components/schemas/Node' },
      {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              next: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    );
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: { next: { next: {} } },
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({
      allOf: [{ type: 'string' }, { enum: ['ok'] }],
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'nope',
      }),
    ).toEqual({
      valid: false,
      errors: ['$: expected one of ["ok"]'],
    });

    setJsonContractSchema({
      type: 'object',
      properties: {
        known: { type: 'string' },
      },
      required: ['known'],
      additionalProperties: false,
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: { extra: 'x' },
      }),
    ).toEqual({
      valid: false,
      errors: ['$.known: is required', '$.extra: is not allowed by schema'],
    });

    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: { known: 'ok' },
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({
      type: 'object',
      additionalProperties: { type: 'integer' },
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: { answer: '42' },
      }),
    ).toEqual({
      valid: false,
      errors: ['$.answer: expected integer, got string'],
    });
  });

  test('validates primitive mismatch messages, union types, and array item schemas', () => {
    setJsonContractSchema({ type: 'null' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: null,
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({ enum: ['ok'] });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'ok',
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({ type: 'string' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: null,
      }),
    ).toEqual({
      valid: false,
      errors: ['$: expected string, got null'],
    });

    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: [],
      }),
    ).toEqual({
      valid: false,
      errors: ['$: expected string, got array'],
    });

    setJsonContractSchema({ type: ['string', 'boolean'] });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 123,
      }),
    ).toEqual({
      valid: false,
      errors: ['$: expected one of string, boolean, got number'],
    });

    setJsonContractSchema({ type: [1, 2] });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 123,
      }),
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('schema is invalid')]),
    });

    setJsonContractSchema({ properties: { name: { type: 'string' } } });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'not-an-object',
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({ type: 'array' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: [1],
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    setJsonContractSchema({ type: 'array', items: { type: 'integer' } });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: [1, '2'],
      }),
    ).toEqual({
      valid: false,
      errors: ['$[1]: expected integer, got string'],
    });

    setJsonContractSchema({
      type: 'object',
      additionalProperties: true,
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: { passthrough: 'ok' },
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('validates oneOf, anyOf, pattern, and format constraints', () => {
    setJsonContractSchema({
      oneOf: [{ type: 'string' }, { type: 'integer' }],
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: true,
      }),
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('oneOf')]),
    });

    setJsonContractSchema({
      anyOf: [{ type: 'string', pattern: '^ok-' }, { type: 'integer' }],
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: false,
      }),
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('anyOf')]),
    });

    setJsonContractSchema({ type: 'string', pattern: '^ok-' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'nope',
      }),
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('pattern')]),
    });

    setJsonContractSchema({ type: 'string', format: 'date-time' });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'not-a-date',
      }),
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('format')]),
    });
  });

  test('returns accumulated errors when object schemas fail the late object-shape check', () => {
    const originalIsArray = Array.isArray;
    const payload = ['value'];
    let payloadChecks = 0;
    const isArraySpy = vi.spyOn(Array, 'isArray').mockImplementation((candidate: unknown) => {
      if (candidate === payload) {
        payloadChecks += 1;
        return payloadChecks > 1;
      }
      return originalIsArray(candidate);
    });
    setJsonContractSchema({
      type: 'object',
      enum: [{ kind: 'object' }],
    });

    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload,
    });

    expect(result).toEqual({
      valid: false,
      errors: ['$: expected one of [{"kind":"object"}]'],
    });
    isArraySpy.mockRestore();
  });

  test('covers defensive array type guard when Array.isArray behavior is inconsistent', () => {
    const originalIsArray = Array.isArray;
    const payload = ['value'];
    let payloadChecks = 0;
    const isArraySpy = vi.spyOn(Array, 'isArray').mockImplementation((candidate: unknown) => {
      if (candidate === payload) {
        payloadChecks += 1;
        return payloadChecks === 1;
      }
      return originalIsArray(candidate);
    });
    setJsonContractSchema({ type: 'array', items: { type: 'string' } });

    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload,
    });

    expect(result).toEqual({
      valid: true,
      errors: [],
    });
    isArraySpy.mockRestore();
  });

  test('formats fallback validation messages for uncommon AJV error shapes', () => {
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementation(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          keyword: 'type',
          instancePath: '/custom/path/deeper',
          params: { type: 'string, number' },
          message: 'ignored',
        },
        {
          keyword: 'required',
          instancePath: '/payload/nested',
          params: { missingProperty: 'child' },
          message: 'must contain required property',
        },
        {
          keyword: 'additionalProperties',
          instancePath: '/payload/nested',
          params: { additionalProperty: 'extra' },
          message: 'must NOT have additional properties',
        },
        {
          keyword: 'required',
          instancePath: '/payload/nested',
          params: { missingProperty: 123 },
          message: 'must contain required property',
        },
        {
          keyword: 'additionalProperties',
          instancePath: '/payload/nested',
          params: { additionalProperty: 123 },
          message: 'must NOT have additional properties',
        },
        {
          keyword: 'type',
          instancePath: '/payload/value',
          params: { type: [1, 2, 3] },
          message: 'must be valid',
        },
        {
          keyword: 'type',
          instancePath: '/payload/objectType',
          params: { type: { unsupported: true } },
          message: 'must be valid type object',
        },
        {
          keyword: 'enum',
          instancePath: '/payload/value',
          params: { allowedValues: 'not-an-array' },
          message: 'must be equal to one of allowed values',
        },
        {
          keyword: 'pattern',
          instancePath: '/payload/value',
          params: { pattern: 123 },
          message: 'must match pattern',
        },
        {
          keyword: 'format',
          instancePath: '/payload/value',
          params: { format: 123 },
          message: 'must match format',
        },
        {
          keyword: 'custom',
          instancePath: '/payload/value',
          params: {},
          message: undefined,
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'object' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: { custom: 'leaf' },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        '$.custom.path.deeper: expected one of string, number, got undefined',
        '$.nested.child: is required',
        '$.nested.extra: is not allowed by schema',
        '$.nested: must contain required property',
        '$.nested: must NOT have additional properties',
        '$.value: must be valid',
        '$.objectType: must be valid type object',
        '$.value: must be equal to one of allowed values',
        '$.value: must match pattern',
        '$.value: must match format',
        '$.value: schema validation failed',
      ]),
    );
    compileSpy.mockRestore();
  });

  test('covers compile-error fallbacks for regex extracted refs, primitive throws, and empty errors', () => {
    setJsonContractSchema({ type: 'string' });

    const compileRegexRefSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      throw new Error('reference #/components/schemas/Missing from "#/"');
    });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'ok',
      }),
    ).toEqual({
      valid: false,
      errors: ['$: unresolved schema reference #/components/schemas/Missing'],
    });
    compileRegexRefSpy.mockRestore();

    const compilePrimitiveThrowSpy = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw 42;
      });
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'ok',
      }),
    ).toEqual({
      valid: false,
      errors: ['$: 42'],
    });
    compilePrimitiveThrowSpy.mockRestore();

    const compileNoErrorsSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = undefined;
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'ok',
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });
    compileNoErrorsSpy.mockRestore();
  });
});
