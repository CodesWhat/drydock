import { openApiDocument } from './openapi.js';

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

type SchemaValidationContext = {
  path: string;
  visitedRefs: Set<string>;
};

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveSchemaRef(ref: string): JsonSchema | undefined {
  const refPrefix = '#/components/schemas/';
  if (!ref.startsWith(refPrefix)) {
    return undefined;
  }
  const schemaName = ref.slice(refPrefix.length);
  return openApiDocument.components.schemas[schemaName] as JsonSchema | undefined;
}

function validatePrimitiveType(expectedType: string, value: unknown): boolean {
  if (expectedType === 'null') return value === null;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return isObjectLike(value);
  if (expectedType === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === expectedType;
}

function validateSchema(
  schema: JsonSchema | undefined,
  value: unknown,
  context: SchemaValidationContext,
): string[] {
  if (!schema) {
    return [`${context.path}: schema is missing`];
  }

  if ('$ref' in schema && typeof schema.$ref === 'string') {
    if (context.visitedRefs.has(schema.$ref)) {
      return [];
    }
    const resolvedSchema = resolveSchemaRef(schema.$ref);
    if (!resolvedSchema) {
      return [`${context.path}: unresolved schema reference ${schema.$ref}`];
    }
    const nextVisitedRefs = new Set(context.visitedRefs);
    nextVisitedRefs.add(schema.$ref);
    return validateSchema(resolvedSchema, value, { ...context, visitedRefs: nextVisitedRefs });
  }

  const errors: string[] = [];

  if (Array.isArray(schema.allOf)) {
    for (const memberSchema of schema.allOf) {
      errors.push(
        ...validateSchema(memberSchema as JsonSchema, value, {
          ...context,
          visitedRefs: new Set(context.visitedRefs),
        }),
      );
    }
  }

  if (Array.isArray(schema.enum)) {
    const isAllowedValue = schema.enum.some((entry) => Object.is(entry, value));
    if (!isAllowedValue) {
      errors.push(`${context.path}: expected one of ${JSON.stringify(schema.enum)}`);
    }
  }

  const schemaType = schema.type;
  if (typeof schemaType === 'string') {
    if (!validatePrimitiveType(schemaType, value)) {
      errors.push(`${context.path}: expected ${schemaType}, got ${describeType(value)}`);
      return errors;
    }
  } else if (Array.isArray(schemaType)) {
    const types = schemaType.filter((entry): entry is string => typeof entry === 'string');
    if (types.length > 0 && !types.some((entry) => validatePrimitiveType(entry, value))) {
      errors.push(
        `${context.path}: expected one of ${types.join(', ')}, got ${describeType(value)}`,
      );
      return errors;
    }
  }

  if (schemaType === 'object' || (schemaType === undefined && isObjectLike(schema.properties))) {
    if (!isObjectLike(value)) {
      if (schemaType !== undefined) {
        return errors;
      }
      errors.push(`${context.path}: expected object, got ${describeType(value)}`);
      return errors;
    }

    const properties = isObjectLike(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];

    for (const propertyName of required) {
      if (!(propertyName in value)) {
        errors.push(`${context.path}.${propertyName}: is required`);
      }
    }

    for (const [propertyName, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[propertyName] as JsonSchema | undefined;
      if (propertySchema) {
        errors.push(
          ...validateSchema(propertySchema, propertyValue, {
            ...context,
            path: `${context.path}.${propertyName}`,
            visitedRefs: new Set(context.visitedRefs),
          }),
        );
        continue;
      }

      if (schema.additionalProperties === false) {
        errors.push(`${context.path}.${propertyName}: is not allowed by schema`);
        continue;
      }

      if (isObjectLike(schema.additionalProperties)) {
        errors.push(
          ...validateSchema(schema.additionalProperties as JsonSchema, propertyValue, {
            ...context,
            path: `${context.path}.${propertyName}`,
            visitedRefs: new Set(context.visitedRefs),
          }),
        );
      }
    }
  }

  if (schemaType === 'array') {
    if (!Array.isArray(value)) {
      return errors;
    }
    const itemSchema = schema.items as JsonSchema | undefined;
    for (let index = 0; index < value.length; index += 1) {
      errors.push(
        ...validateSchema(itemSchema, value[index], {
          ...context,
          path: `${context.path}[${index}]`,
          visitedRefs: new Set(context.visitedRefs),
        }),
      );
    }
  }

  return errors;
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

  const errors = validateSchema(jsonContent.schema, payload, {
    path: '$',
    visitedRefs: new Set<string>(),
  });
  return {
    valid: errors.length === 0,
    errors,
  };
}
