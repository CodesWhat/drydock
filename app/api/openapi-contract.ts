import { createRequire } from 'node:module';
import type { ErrorObject } from 'ajv';
import { openApiDocument } from './openapi.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js') as typeof import('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats') as typeof import('ajv-formats').default;

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
addFormats(ajv);

type OpenApiSchemaObject = Record<string, unknown>;
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

interface FormattedTypeExpectation {
  label: string;
  multiple: boolean;
}

interface ValidationErrorFormatterContext {
  error: ErrorObject;
  payload: unknown;
  payloadPath: string;
  path: string;
}

type ValidationErrorFormatter = (context: ValidationErrorFormatterContext) => string | undefined;

function withChildPayloadPath(parentPath: string, property: string): string {
  const escapedProperty = escapeJsonPointerToken(property);
  return parentPath ? `${parentPath}/${escapedProperty}` : `/${escapedProperty}`;
}

function parseTypeExpectation(typeParam: unknown): FormattedTypeExpectation | undefined {
  if (typeof typeParam === 'string') {
    if (typeParam.includes(',')) {
      return {
        label: typeParam
          .split(',')
          .map((entry) => entry.trim())
          .join(', '),
        multiple: true,
      };
    }
    return { label: typeParam, multiple: false };
  }

  if (Array.isArray(typeParam)) {
    const label = typeParam
      .filter((entry): entry is string => typeof entry === 'string')
      .join(', ');
    if (label.length > 0) {
      return { label, multiple: true };
    }
  }

  return undefined;
}

function formatRequiredValidationError({
  error,
  payloadPath,
}: ValidationErrorFormatterContext): string | undefined {
  const missingProperty = (error.params as { missingProperty?: unknown }).missingProperty;
  if (typeof missingProperty !== 'string') {
    return undefined;
  }

  const missingPropertyPath = withChildPayloadPath(payloadPath, missingProperty);
  return `${toContractPath(missingPropertyPath)}: is required`;
}

function formatAdditionalPropertiesValidationError({
  error,
  payloadPath,
}: ValidationErrorFormatterContext): string | undefined {
  const additionalProperty = (error.params as { additionalProperty?: unknown }).additionalProperty;
  if (typeof additionalProperty !== 'string') {
    return undefined;
  }

  const additionalPropertyPath = withChildPayloadPath(payloadPath, additionalProperty);
  return `${toContractPath(additionalPropertyPath)}: is not allowed by schema`;
}

function formatTypeValidationError({
  error,
  payload,
  payloadPath,
  path,
}: ValidationErrorFormatterContext): string | undefined {
  const expectation = parseTypeExpectation((error.params as { type?: unknown }).type);
  if (!expectation) {
    return undefined;
  }

  const expected = expectation.multiple ? `one of ${expectation.label}` : expectation.label;
  const actualType = describeType(getValueAtPointer(payload, payloadPath));
  return `${path}: expected ${expected}, got ${actualType}`;
}

function formatEnumValidationError({
  error,
  path,
}: ValidationErrorFormatterContext): string | undefined {
  const allowedValues = (error.params as { allowedValues?: unknown }).allowedValues;
  if (!Array.isArray(allowedValues)) {
    return undefined;
  }
  return `${path}: expected one of ${JSON.stringify(allowedValues)}`;
}

function formatPatternValidationError({
  error,
  path,
}: ValidationErrorFormatterContext): string | undefined {
  const pattern = (error.params as { pattern?: unknown }).pattern;
  if (typeof pattern !== 'string') {
    return undefined;
  }
  return `${path}: must match pattern ${JSON.stringify(pattern)}`;
}

function formatFormatValidationError({
  error,
  path,
}: ValidationErrorFormatterContext): string | undefined {
  const format = (error.params as { format?: unknown }).format;
  if (typeof format !== 'string') {
    return undefined;
  }
  return `${path}: must match format ${JSON.stringify(format)}`;
}

function formatCompositeValidationError({ error, path }: ValidationErrorFormatterContext): string {
  return `${path}: failed ${error.keyword}`;
}

const validationErrorFormatters: Readonly<Record<string, ValidationErrorFormatter>> = {
  required: formatRequiredValidationError,
  additionalProperties: formatAdditionalPropertiesValidationError,
  type: formatTypeValidationError,
  enum: formatEnumValidationError,
  oneOf: formatCompositeValidationError,
  anyOf: formatCompositeValidationError,
  pattern: formatPatternValidationError,
  format: formatFormatValidationError,
};

function formatValidationError(error: ErrorObject, payload: unknown): string {
  const payloadPath = stripPayloadPrefix(error.instancePath);
  const path = toContractPath(payloadPath);
  const formatter = validationErrorFormatters[error.keyword];
  const formatted = formatter?.({ error, payload, payloadPath, path });
  if (formatted) {
    return formatted;
  }

  const message = error.message ?? 'schema validation failed';
  return `${path}: ${message}`;
}

function validateSchema(schema: OpenApiSchemaObject, payload: unknown): string[] {
  const wrappedSchema: OpenApiSchemaObject = {
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
        content?: Record<string, { schema?: OpenApiSchemaObject }>;
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
