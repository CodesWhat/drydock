import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../test/helpers.js';
import { sendErrorResponse } from './error-response.js';
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
  test('accepts runtime error-response payload against ErrorResponse schema', () => {
    setJsonContractSchema(
      { $ref: '#/components/schemas/ErrorResponse' },
      { schemas: structuredClone(originalSchemas) },
    );

    const response = createMockResponse();

    sendErrorResponse(response, 400, 'Bad payload');

    expect(response.json).toHaveBeenCalledTimes(1);
    const payload = response.json.mock.calls[0]?.[0];

    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload,
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

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

  test('decodes ~1 and ~0 tokens in JSON pointer paths to / and ~', () => {
    // ~1 → /  (JSON Pointer token for forward slash)
    // ~0 → ~  (JSON Pointer token for tilde)
    // This exercises decodeJsonPointerToken used inside toContractPath
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          keyword: 'type',
          instancePath: '/payload/a~1b',
          params: { type: 'string' },
          message: 'must be string',
        },
        {
          keyword: 'type',
          instancePath: '/payload/a~0b',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'object' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: { 'a/b': 1, 'a~b': 2 },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('$.a/b: expected string, got number');
    expect(result.errors).toContain('$.a~b: expected string, got number');
    compileSpy.mockRestore();
  });

  test('encodes ~ and / in missing property names for JSON pointer paths', () => {
    // This exercises escapeJsonPointerToken via withChildPayloadPath → formatRequiredValidationError
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          keyword: 'required',
          instancePath: '/payload',
          params: { missingProperty: 'a/b' },
          message: 'must have required property',
        },
        {
          keyword: 'required',
          instancePath: '/payload',
          params: { missingProperty: 'a~b' },
          message: 'must have required property',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'object' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: {},
    });

    expect(result.valid).toBe(false);
    // escapeJsonPointerToken: / → ~1, ~ → ~0; then toContractPath decodes back
    expect(result.errors).toContain('$.a/b: is required');
    expect(result.errors).toContain('$.a~b: is required');
    compileSpy.mockRestore();
  });

  test('stripPayloadPrefix: /payload exactly maps to empty string (root path)', () => {
    // Exercises stripPayloadPrefix(instancePath === '/payload') returning ''
    // which toContractPath converts to '$'
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          keyword: 'type',
          instancePath: '/payload',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'string' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 42,
    });

    expect(result.valid).toBe(false);
    // instancePath '/payload' → stripped to '' → toContractPath('') === '$'
    expect(result.errors).toContain('$: expected string, got number');
    compileSpy.mockRestore();
  });

  test('toContractPath: empty string maps to $, numeric segments map to [n], alpha to .name', () => {
    // Tests toContractPath with numeric index (must use [n] not .n)
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        // numeric segment → [0]
        {
          keyword: 'type',
          instancePath: '/payload/0',
          params: { type: 'string' },
          message: 'must be string',
        },
        // alpha segment → .name
        {
          keyword: 'type',
          instancePath: '/payload/name',
          params: { type: 'string' },
          message: 'must be string',
        },
        // nested: array then property
        {
          keyword: 'type',
          instancePath: '/payload/items/2/value',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'array' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: [1, 'two'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('$[0]: expected string, got number');
    expect(result.errors).toContain('$.name: expected string, got undefined');
    // /payload/items/2/value → stripped → /items/2/value → $.items[2].value
    expect(result.errors).toContain('$.items[2].value: expected string, got undefined');
    compileSpy.mockRestore();
  });

  test('getValueAtPointer: empty path returns the root object itself', () => {
    // Exercises the !instancePath → return root branch in getValueAtPointer
    // Used by formatTypeValidationError to get the actual value for error messages
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          // instancePath '/payload' → stripped to '' → getValueAtPointer(payload, '') returns payload itself
          keyword: 'type',
          instancePath: '/payload',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'string' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: [1, 2, 3],
    });

    expect(result.valid).toBe(false);
    // describeType([1,2,3]) === 'array', so "got array"
    expect(result.errors).toContain('$: expected string, got array');
    compileSpy.mockRestore();
  });

  test('missingRefFromError: object with missingRef string property is extracted', () => {
    // Exercises all branches of missingRefFromError including null/object checks
    setJsonContractSchema({ type: 'string' });

    // Case 1: plain object with missingRef property (AJV-specific error shape)
    const compileWithMissingRefObj = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        const err = Object.assign(new Error('schema error'), {
          missingRef: '#/components/schemas/MySchema',
        });
        throw err;
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
      errors: ['$: unresolved schema reference #/components/schemas/MySchema'],
    });
    compileWithMissingRefObj.mockRestore();

    // Case 2: plain object (non-Error) with missingRef
    const compileWithPlainObj = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw { missingRef: '#/components/schemas/OtherSchema' };
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
      errors: ['$: unresolved schema reference #/components/schemas/OtherSchema'],
    });
    compileWithPlainObj.mockRestore();

    // Case 3: error with missingRef = null (not a string → falls through)
    const compileWithNullMissingRef = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw { missingRef: null };
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
      errors: ['$: [object Object]'],
    });
    compileWithNullMissingRef.mockRestore();

    // Case 4: non-object (null) — typeof null === 'object' but null check prevents missingRef access
    const compileWithNull = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw null;
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
      errors: ['$: null'],
    });
    compileWithNull.mockRestore();
  });

  test('missingRefFromError: Error with missingRef in message is extracted via regex', () => {
    // Exercises the Error instanceof branch with regex match on message
    setJsonContractSchema({ type: 'string' });

    // Exact pattern: "reference <name> from" (with leading/trailing spaces, word boundary)
    const compileWithRegexRef = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw new Error('can\'t resolve reference #/components/schemas/Missing from "#/"');
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
    compileWithRegexRef.mockRestore();

    // Non-matching Error message — falls through to generic Error.message handler
    const compileWithNonMatchingError = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw new Error('something completely different');
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
      errors: ['$: something completely different'],
    });
    compileWithNonMatchingError.mockRestore();
  });

  test('formatPatternValidationError: returns exact "must match pattern <pattern>" string', () => {
    setJsonContractSchema({ type: 'string', pattern: '^hello-' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 'world',
    });
    expect(result).toStrictEqual({
      valid: false,
      errors: ['$: must match pattern "^hello-"'],
    });
  });

  test('formatFormatValidationError: returns exact "must match format <format>" string', () => {
    setJsonContractSchema({ type: 'string', format: 'date-time' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 'not-a-date-time',
    });
    expect(result).toStrictEqual({
      valid: false,
      errors: ['$: must match format "date-time"'],
    });
  });

  test('formatCompositeValidationError: returns exact "${path}: failed ${keyword}" string', () => {
    // Exercises L226 return value with exact assertion
    setJsonContractSchema({
      oneOf: [{ type: 'string' }, { type: 'integer' }],
    });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('$: failed oneOf');
  });

  test('validateSchema wraps payload: requires payload key and rejects extra properties', () => {
    // Exercises L259 required:['payload'] and L260 additionalProperties:false
    // If required:[] were substituted, an undefined payload would be valid
    // If additionalProperties:true were substituted, extra keys would be allowed
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile');

    setJsonContractSchema({ type: 'string' });

    // A valid payload passes through properly
    const validResult = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 'hello',
    });
    expect(validResult).toStrictEqual({ valid: true, errors: [] });

    // An invalid payload is correctly caught
    const invalidResult = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 123,
    });
    expect(invalidResult).toStrictEqual({
      valid: false,
      errors: ['$: expected string, got number'],
    });

    compileSpy.mockRestore();
  });

  test('validateSchema: valid payload returns early with empty errors array', () => {
    // Exercises the if (isValid) { return []; } branch (L277)
    setJsonContractSchema({ type: 'number' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 42,
    });
    // If the BlockStatement were emptied, the function would fall through and try to map null errors
    expect(result).toStrictEqual({ valid: true, errors: [] });
  });

  test('optional chaining on response.content handles undefined content gracefully', () => {
    // Exercises the ?. on response.content at L315
    // A response object without content field should trigger the "No application/json schema" path
    mutableOpenApiDocument.paths = {
      '/contract': {
        get: {
          responses: {
            '200': {
              // no content key at all
            },
          },
        },
      },
    };
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(result).toStrictEqual({
      valid: false,
      errors: ['No application/json schema for GET /contract 200'],
    });
  });

  test('allErrors:true collects all validation errors, not just the first', () => {
    // Exercises L11 allErrors:true — if mutated to false, AJV stops after 1st error
    setJsonContractSchema({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: {},
    });
    expect(result.valid).toBe(false);
    // With allErrors:true all 3 missing properties are reported
    expect(result.errors).toHaveLength(3);
    expect(result.errors).toContain('$.a: is required');
    expect(result.errors).toContain('$.b: is required');
    expect(result.errors).toContain('$.c: is required');
  });

  test('reuses one AJV instance across validateSchema calls', () => {
    const compileInstances = new Set<object>();
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementation(function (
      this: InstanceType<typeof Ajv2020>,
    ) {
      compileInstances.add(this as object);
      const validate = ((_: unknown) => true) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'string' });
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

    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'still-ok',
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });

    expect(compileSpy).toHaveBeenCalledTimes(2);
    expect(compileInstances.size).toBe(1);
    compileSpy.mockRestore();
  });

  test('allowUnionTypes:true allows type arrays; false causes compile error for union types', () => {
    // Exercises L11:20 allowUnionTypes: true → false
    // With allowUnionTypes:false, AJV in strict:false may throw on type arrays
    // We need a schema that uses type:[...] and verify the result is a valid validation,
    // not a compile-time error.
    setJsonContractSchema({ type: ['string', 'number'] });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: true, // boolean, not string or number
    });
    // With allowUnionTypes:true, AJV validates normally and reports a type error
    // With allowUnionTypes:false, AJV may throw during compile and report a compile error
    // Either way invalid, but the error message structure distinguishes them:
    // valid=false, and errors should NOT start with '$: ' with a compile-error message
    expect(result.valid).toBe(false);
    // The error should be a type validation error, not a compile error like 'allowUnionTypes'
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/expected one of string, number, got boolean/);
  });

  test('toContractPath: multi-digit segments use [n] and mixed alphanumeric uses .name', () => {
    // Exercises L63:24 regex ^\d+$ — kills the /^\d$/ (single digit only) mutation
    // Multi-digit "10" must map to [10], not .10
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        // multi-digit index: must be [10], not .10
        {
          keyword: 'type',
          instancePath: '/payload/10',
          params: { type: 'string' },
          message: 'must be string',
        },
        // alphanumeric starting with digits: "10abc" must be .10abc, not [10abc]
        {
          keyword: 'type',
          instancePath: '/payload/10abc',
          params: { type: 'string' },
          message: 'must be string',
        },
        // alphanumeric ending with digits: "abc10" must be .abc10, not [abc10]
        {
          keyword: 'type',
          instancePath: '/payload/abc10',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'object' });
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: { 10: 1, '10abc': 2, abc10: 3 },
    });

    expect(result.valid).toBe(false);
    // multi-digit pure number → [10]
    expect(result.errors).toContain('$[10]: expected string, got number');
    // alphanumeric "10abc" → .10abc (not a pure digit sequence)
    expect(result.errors).toContain('$.10abc: expected string, got number');
    // alphanumeric "abc10" → .abc10 (not a pure digit sequence)
    expect(result.errors).toContain('$.abc10: expected string, got number');
    compileSpy.mockRestore();
  });

  test('getValueAtPointer: navigating through null returns undefined without throwing', () => {
    // Exercises L77:40 current === null check
    // If current === null is removed from the guard, (null as obj)[key] would throw
    const compileSpy = vi.spyOn(Ajv2020.prototype, 'compile').mockImplementationOnce(() => {
      const validate = ((_: unknown) => false) as {
        (input: unknown): boolean;
        errors?: Array<Record<string, unknown>>;
      };
      validate.errors = [
        {
          keyword: 'type',
          instancePath: '/payload/parent/child',
          params: { type: 'string' },
          message: 'must be string',
        },
      ];
      return validate as ReturnType<InstanceType<typeof Ajv2020>['compile']>;
    });

    setJsonContractSchema({ type: 'object' });
    // payload.parent is null — getValueAtPointer must handle this without throwing
    const result = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: { parent: null },
    });

    expect(result.valid).toBe(false);
    // null['child'] would throw without the guard; with the guard returns undefined
    expect(result.errors).toContain('$.parent.child: expected string, got undefined');
    compileSpy.mockRestore();
  });

  test('missingRefFromError: non-string missingRef is ignored and falls through', () => {
    // Exercises L90:5 typeof missingRef === 'string' → true
    // If the type check is replaced with true, a numeric missingRef would be returned
    // and truthy (e.g., missingRef: 42) would produce "unresolved schema reference 42"
    // instead of falling through to String(error) = '[object Object]'
    setJsonContractSchema({ type: 'string' });

    const compileWithNumericMissingRef = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw { missingRef: 42 }; // number, not string
      });
    // With the correct check (typeof missingRef === 'string'), missingRef:42 is NOT a string
    // so it falls through → returns '[object Object]'
    expect(
      validateOpenApiJsonResponse({
        path: '/contract',
        method: 'get',
        statusCode: '200',
        payload: 'ok',
      }),
    ).toEqual({
      valid: false,
      errors: ['$: [object Object]'],
    });
    compileWithNumericMissingRef.mockRestore();
  });

  test('missingRefFromError: regex captures ref even with multiple spaces around it', () => {
    // Exercises L96:48 regex /reference\s+(.+?)\s+from\b/i
    // Kills /reference\s(.+?)\s+from\b/i (no + after first \s) and
    //       /reference\s+(.+?)\sfrom\b/i (no + before from)
    // With multiple spaces, the weaker mutations would capture extra whitespace
    setJsonContractSchema({ type: 'string' });

    // Test with multiple spaces before the ref (distinguishes \s from \s+)
    const compileMultiSpaceBefore = vi
      .spyOn(Ajv2020.prototype, 'compile')
      .mockImplementationOnce(() => {
        throw new Error('can\'t resolve reference  #/components/schemas/Missing  from "#/"');
      });
    const resultMultiSpace = validateOpenApiJsonResponse({
      path: '/contract',
      method: 'get',
      statusCode: '200',
      payload: 'ok',
    });
    // Original: \s+(.+?)\s+from → captures '#/components/schemas/Missing' (no leading space)
    // Mutant \s(.+?)\s+from → captures ' #/components/schemas/Missing' (with leading space)
    // Mutant \s+(.+?)\sfrom → captures '#/components/schemas/Missing ' (with trailing space)
    expect(resultMultiSpace).toEqual({
      valid: false,
      errors: ['$: unresolved schema reference #/components/schemas/Missing'],
    });
    compileMultiSpaceBefore.mockRestore();
  });
});
