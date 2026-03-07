import { createRequire } from 'node:module';
import type { ErrorObject } from 'ajv';
import { openApiDocument } from './openapi.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js') as typeof import('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats') as typeof import('ajv-formats').default;

type JsonSchema = Record<string, unknown>;
type OpenApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface ContractValidationResult {
  valid: boolean;
  errors: string[];
}

interface OpenApiJsonResponseInput {
  path: string;
  method: OpenApiMethod;
  statusCode: string;
  payload: unknown;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

function stripPayloadPrefix(instancePath: string): string {
  if (instancePath === '/payload') {
    return '';
  }
  if (instancePath.startsWith('/payload/')) {
    return instancePath.slice('/payload'.length);
  }
  return instancePath;
}

function toContractPath(instancePath: string): string {
  if (!instancePath) {
    return '$';
  }
  const segments = instancePath
    .split('/')
    .slice(1)
    .map((segment) => decodeJsonPointerToken(segment))
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`));
  return `$${segments.join('')}`;
}

function getValueAtPointer(root: unknown, instancePath: string): unknown {
  if (!instancePath) {
    return root;
  }
  const segments = instancePath
    .split('/')
    .slice(1)
    .map((segment) => decodeJsonPointerToken(segment));
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function missingRefFromError(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'missingRef' in error &&
    typeof (error as { missingRef?: unknown }).missingRef === 'string'
  ) {
    return (error as { missingRef: string }).missingRef;
  }

  if (error instanceof Error) {
    const referenceMatch = error.message.match(/reference\s+(.+?)\s+from\b/i);
    if (referenceMatch?.[1]) {
      return referenceMatch[1];
    }
  }

  return undefined;
}

function formatValidationError(error: ErrorObject, payload: unknown): string {
  const payloadPath = stripPayloadPrefix(error.instancePath);
  const path = toContractPath(payloadPath);

  if (error.keyword === 'required') {
    const missingProperty = (error.params as { missingProperty?: unknown }).missingProperty;
    if (typeof missingProperty === 'string') {
      const missingPropertyPath = payloadPath
        ? `${payloadPath}/${escapeJsonPointerToken(missingProperty)}`
        : `/${escapeJsonPointerToken(missingProperty)}`;
      return `${toContractPath(missingPropertyPath)}: is required`;
    }
  }

  if (error.keyword === 'additionalProperties') {
    const additionalProperty = (error.params as { additionalProperty?: unknown })
      .additionalProperty;
    if (typeof additionalProperty === 'string') {
      const additionalPropertyPath = payloadPath
        ? `${payloadPath}/${escapeJsonPointerToken(additionalProperty)}`
        : `/${escapeJsonPointerToken(additionalProperty)}`;
      return `${toContractPath(additionalPropertyPath)}: is not allowed by schema`;
    }
  }

  if (error.keyword === 'type') {
    const expectedType = (error.params as { type?: unknown }).type;
    const actualType = describeType(getValueAtPointer(payload, payloadPath));
    if (typeof expectedType === 'string') {
      if (expectedType.includes(',')) {
        const expectedTypes = expectedType
          .split(',')
          .map((entry) => entry.trim())
          .join(', ');
        return `${path}: expected one of ${expectedTypes}, got ${actualType}`;
      }
      return `${path}: expected ${expectedType}, got ${actualType}`;
    }
    if (Array.isArray(expectedType)) {
      const expectedTypes = expectedType
        .filter((entry): entry is string => typeof entry === 'string')
        .join(', ');
      if (expectedTypes.length > 0) {
        return `${path}: expected one of ${expectedTypes}, got ${actualType}`;
      }
    }
  }

  if (error.keyword === 'enum') {
    const allowedValues = (error.params as { allowedValues?: unknown }).allowedValues;
    if (Array.isArray(allowedValues)) {
      return `${path}: expected one of ${JSON.stringify(allowedValues)}`;
    }
  }

  if (error.keyword === 'oneOf' || error.keyword === 'anyOf') {
    return `${path}: failed ${error.keyword}`;
  }

  if (error.keyword === 'pattern') {
    const pattern = (error.params as { pattern?: unknown }).pattern;
    if (typeof pattern === 'string') {
      return `${path}: must match pattern ${JSON.stringify(pattern)}`;
    }
  }

  if (error.keyword === 'format') {
    const format = (error.params as { format?: unknown }).format;
    if (typeof format === 'string') {
      return `${path}: must match format ${JSON.stringify(format)}`;
    }
  }

  const message = error.message ?? 'schema validation failed';
  return `${path}: ${message}`;
}

function validateSchema(schema: JsonSchema, payload: unknown): string[] {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: false,
  });
  addFormats(ajv);

  const wrappedSchema: JsonSchema = {
    type: 'object',
    properties: {
      payload: schema,
    },
    required: ['payload'],
    additionalProperties: false,
    components: openApiDocument.components,
  };

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(wrappedSchema);
  } catch (error) {
    const missingRef = missingRefFromError(error);
    if (missingRef) {
      return [`$: unresolved schema reference ${missingRef}`];
    }
    const message = error instanceof Error ? error.message : String(error);
    return [`$: ${message}`];
  }

  const isValid = validate({ payload });
  if (isValid) {
    return [];
  }

  const errors = validate.errors ?? [];
  return errors.map((error) => formatValidationError(error, payload));
}

export function validateOpenApiJsonResponse(
  input: OpenApiJsonResponseInput,
): ContractValidationResult {
  const { path, method, statusCode, payload } = input;
  const pathItem = openApiDocument.paths[path] as Record<string, unknown> | undefined;
  if (!pathItem) {
    return { valid: false, errors: [`Unknown OpenAPI path: ${path}`] };
  }

  const operation = pathItem[method] as
    | {
        responses?: Record<string, unknown>;
      }
    | undefined;
  if (!operation?.responses) {
    return { valid: false, errors: [`Unknown operation: ${method.toUpperCase()} ${path}`] };
  }

  const response = operation.responses[statusCode] as
    | {
        content?: Record<string, { schema?: JsonSchema }>;
      }
    | undefined;
  if (!response) {
    return {
      valid: false,
      errors: [`Unknown response status ${statusCode} for ${method.toUpperCase()} ${path}`],
    };
  }

  const jsonContent = response.content?.['application/json'];
  if (!jsonContent?.schema) {
    return {
      valid: false,
      errors: [`No application/json schema for ${method.toUpperCase()} ${path} ${statusCode}`],
    };
  }

  const errors = validateSchema(jsonContent.schema, payload);
  return {
    valid: errors.length === 0,
    errors,
  };
}
