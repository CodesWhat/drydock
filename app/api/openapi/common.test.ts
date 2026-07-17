import {
  agentNamePathParam,
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  containerIdPathParam,
  containerListQueryParams,
  containerNamePathParam,
  destructiveConfirmationHeaderParam,
  emptyObjectSchema,
  errorResponse,
  genericArraySchema,
  genericObjectSchema,
  iconProviderPathParam,
  iconSlugPathParam,
  jsonResponse,
  noContentResponse,
  notificationRuleIdPathParam,
  operationIdPathParam,
  paginationQueryParams,
  triggerAgentPathParam,
  triggerNamePathParam,
  triggerTypePathParam,
} from './common.js';

describe('genericObjectSchema', () => {
  test('has type object and additionalProperties true', () => {
    expect(genericObjectSchema).toStrictEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  test('type is exactly "object"', () => {
    expect(genericObjectSchema.type).toBe('object');
  });

  test('additionalProperties is true (boolean)', () => {
    expect(genericObjectSchema.additionalProperties).toBe(true);
  });
});

describe('genericArraySchema', () => {
  test('has type array with items spread from genericObjectSchema', () => {
    expect(genericArraySchema).toStrictEqual({
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    });
  });

  test('type is exactly "array"', () => {
    expect(genericArraySchema.type).toBe('array');
  });

  test('items matches genericObjectSchema', () => {
    expect(genericArraySchema.items).toStrictEqual(genericObjectSchema);
  });
});

describe('emptyObjectSchema', () => {
  test('has type object and additionalProperties false', () => {
    expect(emptyObjectSchema).toStrictEqual({
      type: 'object',
      additionalProperties: false,
    });
  });

  test('type is exactly "object"', () => {
    expect(emptyObjectSchema.type).toBe('object');
  });

  test('additionalProperties is false (boolean)', () => {
    expect(emptyObjectSchema.additionalProperties).toBe(false);
  });
});

describe('jsonResponse', () => {
  test('returns object with description and application/json content', () => {
    const schema = { $ref: '#/components/schemas/Foo' };
    const result = jsonResponse('Success', schema);
    expect(result).toStrictEqual({
      description: 'Success',
      content: {
        'application/json': { schema },
      },
    });
  });

  test('description is used verbatim', () => {
    const result = jsonResponse('My description', { $ref: '#/components/schemas/Bar' });
    expect(result.description).toBe('My description');
  });

  test('schema is passed through as-is', () => {
    const schema = { type: 'string' } as const;
    const result = jsonResponse('test', schema);
    expect(result.content['application/json'].schema).toBe(schema);
  });
});

describe('errorResponse', () => {
  test('returns object with description and ErrorResponse $ref', () => {
    const result = errorResponse('Not found');
    expect(result).toStrictEqual({
      description: 'Not found',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    });
  });

  test('description is used verbatim', () => {
    const result = errorResponse('Authentication required');
    expect(result.description).toBe('Authentication required');
  });

  test('$ref points to ErrorResponse schema', () => {
    const result = errorResponse('test');
    expect(result.content['application/json'].schema).toStrictEqual({
      $ref: '#/components/schemas/ErrorResponse',
    });
  });
});

describe('noContentResponse', () => {
  test('has description "No content"', () => {
    expect(noContentResponse).toStrictEqual({ description: 'No content' });
  });

  test('description is exactly "No content"', () => {
    expect(noContentResponse.description).toBe('No content');
  });
});

describe('containerIdPathParam', () => {
  test('has all required fields', () => {
    expect(containerIdPathParam).toStrictEqual({
      name: 'id',
      in: 'path',
      required: true,
      description: 'Container identifier',
      schema: { type: 'string' },
    });
  });

  test('name is "id"', () => {
    expect(containerIdPathParam.name).toBe('id');
  });

  test('in is "path"', () => {
    expect(containerIdPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(containerIdPathParam.required).toBe(true);
  });

  test('description is "Container identifier"', () => {
    expect(containerIdPathParam.description).toBe('Container identifier');
  });

  test('schema type is "string"', () => {
    expect(containerIdPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('componentTypePathParam', () => {
  test('has all required fields', () => {
    expect(componentTypePathParam).toStrictEqual({
      name: 'type',
      in: 'path',
      required: true,
      description: 'Component type',
      schema: { type: 'string' },
    });
  });

  test('name is "type"', () => {
    expect(componentTypePathParam.name).toBe('type');
  });

  test('in is "path"', () => {
    expect(componentTypePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(componentTypePathParam.required).toBe(true);
  });

  test('description is "Component type"', () => {
    expect(componentTypePathParam.description).toBe('Component type');
  });

  test('schema type is "string"', () => {
    expect(componentTypePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('componentNamePathParam', () => {
  test('has all required fields', () => {
    expect(componentNamePathParam).toStrictEqual({
      name: 'name',
      in: 'path',
      required: true,
      description: 'Component name',
      schema: { type: 'string' },
    });
  });

  test('name is "name"', () => {
    expect(componentNamePathParam.name).toBe('name');
  });

  test('in is "path"', () => {
    expect(componentNamePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(componentNamePathParam.required).toBe(true);
  });

  test('description is "Component name"', () => {
    expect(componentNamePathParam.description).toBe('Component name');
  });

  test('schema type is "string"', () => {
    expect(componentNamePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('componentAgentPathParam', () => {
  test('has all required fields', () => {
    expect(componentAgentPathParam).toStrictEqual({
      name: 'agent',
      in: 'path',
      required: true,
      description: 'Agent name',
      schema: { type: 'string' },
    });
  });

  test('name is "agent"', () => {
    expect(componentAgentPathParam.name).toBe('agent');
  });

  test('in is "path"', () => {
    expect(componentAgentPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(componentAgentPathParam.required).toBe(true);
  });

  test('description is "Agent name"', () => {
    expect(componentAgentPathParam.description).toBe('Agent name');
  });

  test('schema type is "string"', () => {
    expect(componentAgentPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('triggerTypePathParam', () => {
  test('has all required fields', () => {
    expect(triggerTypePathParam).toStrictEqual({
      name: 'triggerType',
      in: 'path',
      required: true,
      description: 'Trigger type',
      schema: { type: 'string' },
    });
  });

  test('name is "triggerType"', () => {
    expect(triggerTypePathParam.name).toBe('triggerType');
  });

  test('in is "path"', () => {
    expect(triggerTypePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(triggerTypePathParam.required).toBe(true);
  });

  test('description is "Trigger type"', () => {
    expect(triggerTypePathParam.description).toBe('Trigger type');
  });

  test('schema type is "string"', () => {
    expect(triggerTypePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('triggerNamePathParam', () => {
  test('has all required fields', () => {
    expect(triggerNamePathParam).toStrictEqual({
      name: 'triggerName',
      in: 'path',
      required: true,
      description: 'Trigger name',
      schema: { type: 'string' },
    });
  });

  test('name is "triggerName"', () => {
    expect(triggerNamePathParam.name).toBe('triggerName');
  });

  test('in is "path"', () => {
    expect(triggerNamePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(triggerNamePathParam.required).toBe(true);
  });

  test('description is "Trigger name"', () => {
    expect(triggerNamePathParam.description).toBe('Trigger name');
  });

  test('schema type is "string"', () => {
    expect(triggerNamePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('triggerAgentPathParam', () => {
  test('has all required fields', () => {
    expect(triggerAgentPathParam).toStrictEqual({
      name: 'triggerAgent',
      in: 'path',
      required: true,
      description: 'Trigger agent name',
      schema: { type: 'string' },
    });
  });

  test('name is "triggerAgent"', () => {
    expect(triggerAgentPathParam.name).toBe('triggerAgent');
  });

  test('in is "path"', () => {
    expect(triggerAgentPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(triggerAgentPathParam.required).toBe(true);
  });

  test('description is "Trigger agent name"', () => {
    expect(triggerAgentPathParam.description).toBe('Trigger agent name');
  });

  test('schema type is "string"', () => {
    expect(triggerAgentPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('agentNamePathParam', () => {
  test('has all required fields', () => {
    expect(agentNamePathParam).toStrictEqual({
      name: 'name',
      in: 'path',
      required: true,
      description: 'Agent name',
      schema: { type: 'string' },
    });
  });

  test('name is "name"', () => {
    expect(agentNamePathParam.name).toBe('name');
  });

  test('in is "path"', () => {
    expect(agentNamePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(agentNamePathParam.required).toBe(true);
  });

  test('description is "Agent name"', () => {
    expect(agentNamePathParam.description).toBe('Agent name');
  });

  test('schema type is "string"', () => {
    expect(agentNamePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('operationIdPathParam', () => {
  test('has all required fields', () => {
    expect(operationIdPathParam).toStrictEqual({
      name: 'operationId',
      in: 'path',
      required: true,
      description: 'Self-update operation identifier',
      schema: { type: 'string' },
    });
  });

  test('name is "operationId"', () => {
    expect(operationIdPathParam.name).toBe('operationId');
  });

  test('in is "path"', () => {
    expect(operationIdPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(operationIdPathParam.required).toBe(true);
  });

  test('description is "Self-update operation identifier"', () => {
    expect(operationIdPathParam.description).toBe('Self-update operation identifier');
  });

  test('schema type is "string"', () => {
    expect(operationIdPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('containerNamePathParam', () => {
  test('has all required fields', () => {
    expect(containerNamePathParam).toStrictEqual({
      name: 'containerName',
      in: 'path',
      required: true,
      description: 'Container name',
      schema: { type: 'string' },
    });
  });

  test('name is "containerName"', () => {
    expect(containerNamePathParam.name).toBe('containerName');
  });

  test('in is "path"', () => {
    expect(containerNamePathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(containerNamePathParam.required).toBe(true);
  });

  test('description is "Container name"', () => {
    expect(containerNamePathParam.description).toBe('Container name');
  });

  test('schema type is "string"', () => {
    expect(containerNamePathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('iconProviderPathParam', () => {
  test('has all required fields', () => {
    expect(iconProviderPathParam).toStrictEqual({
      name: 'provider',
      in: 'path',
      required: true,
      description: 'Icon provider name',
      schema: { type: 'string' },
    });
  });

  test('name is "provider"', () => {
    expect(iconProviderPathParam.name).toBe('provider');
  });

  test('in is "path"', () => {
    expect(iconProviderPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(iconProviderPathParam.required).toBe(true);
  });

  test('description is "Icon provider name"', () => {
    expect(iconProviderPathParam.description).toBe('Icon provider name');
  });

  test('schema type is "string"', () => {
    expect(iconProviderPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('iconSlugPathParam', () => {
  test('has all required fields', () => {
    expect(iconSlugPathParam).toStrictEqual({
      name: 'slug',
      in: 'path',
      required: true,
      description: 'Icon slug',
      schema: { type: 'string' },
    });
  });

  test('name is "slug"', () => {
    expect(iconSlugPathParam.name).toBe('slug');
  });

  test('in is "path"', () => {
    expect(iconSlugPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(iconSlugPathParam.required).toBe(true);
  });

  test('description is "Icon slug"', () => {
    expect(iconSlugPathParam.description).toBe('Icon slug');
  });

  test('schema type is "string"', () => {
    expect(iconSlugPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('notificationRuleIdPathParam', () => {
  test('has all required fields', () => {
    expect(notificationRuleIdPathParam).toStrictEqual({
      name: 'id',
      in: 'path',
      required: true,
      description: 'Notification rule identifier',
      schema: { type: 'string' },
    });
  });

  test('name is "id"', () => {
    expect(notificationRuleIdPathParam.name).toBe('id');
  });

  test('in is "path"', () => {
    expect(notificationRuleIdPathParam.in).toBe('path');
  });

  test('required is true', () => {
    expect(notificationRuleIdPathParam.required).toBe(true);
  });

  test('description is "Notification rule identifier"', () => {
    expect(notificationRuleIdPathParam.description).toBe('Notification rule identifier');
  });

  test('schema type is "string"', () => {
    expect(notificationRuleIdPathParam.schema).toStrictEqual({ type: 'string' });
  });
});

describe('paginationQueryParams', () => {
  test('is an array with exactly two elements', () => {
    expect(Array.isArray(paginationQueryParams)).toBe(true);
    expect(paginationQueryParams).toHaveLength(2);
  });

  test('first element is the limit parameter', () => {
    expect(paginationQueryParams[0]).toStrictEqual({
      name: 'limit',
      in: 'query',
      required: false,
      description: 'Max number of items to return (0-200)',
      schema: { type: 'integer', minimum: 0, maximum: 200 },
    });
  });

  test('second element is the offset parameter', () => {
    expect(paginationQueryParams[1]).toStrictEqual({
      name: 'offset',
      in: 'query',
      required: false,
      description: 'Offset into results list',
      schema: { type: 'integer', minimum: 0 },
    });
  });

  test('limit param name is "limit"', () => {
    expect(paginationQueryParams[0].name).toBe('limit');
  });

  test('limit param in is "query"', () => {
    expect(paginationQueryParams[0].in).toBe('query');
  });

  test('limit param required is false', () => {
    expect(paginationQueryParams[0].required).toBe(false);
  });

  test('limit param description is correct', () => {
    expect(paginationQueryParams[0].description).toBe('Max number of items to return (0-200)');
  });

  test('limit param schema has type integer with min 0 max 200', () => {
    expect(paginationQueryParams[0].schema).toStrictEqual({
      type: 'integer',
      minimum: 0,
      maximum: 200,
    });
  });

  test('offset param name is "offset"', () => {
    expect(paginationQueryParams[1].name).toBe('offset');
  });

  test('offset param in is "query"', () => {
    expect(paginationQueryParams[1].in).toBe('query');
  });

  test('offset param required is false', () => {
    expect(paginationQueryParams[1].required).toBe(false);
  });

  test('offset param description is correct', () => {
    expect(paginationQueryParams[1].description).toBe('Offset into results list');
  });

  test('offset param schema has type integer with min 0', () => {
    expect(paginationQueryParams[1].schema).toStrictEqual({ type: 'integer', minimum: 0 });
  });
});

describe('containerListQueryParams', () => {
  test('is an array with all documented list parameters', () => {
    expect(Array.isArray(containerListQueryParams)).toBe(true);
    expect(containerListQueryParams.map((param) => param.name)).toStrictEqual([
      'limit',
      'offset',
      'includeVulnerabilities',
      'sort',
      'order',
      'status',
      'kind',
      'watcher',
      'maturity',
    ]);
  });

  test('first two elements come from paginationQueryParams', () => {
    expect(containerListQueryParams[0]).toStrictEqual(paginationQueryParams[0]);
    expect(containerListQueryParams[1]).toStrictEqual(paginationQueryParams[1]);
  });

  test('third element is the includeVulnerabilities parameter', () => {
    expect(containerListQueryParams[2]).toStrictEqual({
      name: 'includeVulnerabilities',
      in: 'query',
      required: false,
      description: 'When true, include full vulnerability arrays in container payloads',
      schema: { type: 'boolean' },
    });
  });

  test('includeVulnerabilities param name is correct', () => {
    expect(containerListQueryParams[2].name).toBe('includeVulnerabilities');
  });

  test('includeVulnerabilities param in is "query"', () => {
    expect(containerListQueryParams[2].in).toBe('query');
  });

  test('includeVulnerabilities param required is false', () => {
    expect(containerListQueryParams[2].required).toBe(false);
  });

  test('includeVulnerabilities param description is correct', () => {
    expect(containerListQueryParams[2].description).toBe(
      'When true, include full vulnerability arrays in container payloads',
    );
  });

  test('includeVulnerabilities param schema type is "boolean"', () => {
    expect(containerListQueryParams[2].schema).toStrictEqual({ type: 'boolean' });
  });
});

describe('destructiveConfirmationHeaderParam', () => {
  test('returns param with name X-DD-Confirm-Action in header', () => {
    const result = destructiveConfirmationHeaderParam('delete-all');
    expect(result.name).toBe('X-DD-Confirm-Action');
    expect(result.in).toBe('header');
  });

  test('required is true', () => {
    const result = destructiveConfirmationHeaderParam('any-token');
    expect(result.required).toBe(true);
  });

  test('description interpolates the action token', () => {
    const result = destructiveConfirmationHeaderParam('delete-all');
    expect(result.description).toBe('Confirmation token for destructive action (delete-all)');
  });

  test('schema type is string with enum containing the token', () => {
    const result = destructiveConfirmationHeaderParam('purge');
    expect(result.schema).toStrictEqual({
      type: 'string',
      enum: ['purge'],
    });
  });

  test('enum contains exactly the provided token', () => {
    const token = 'my-action-token';
    const result = destructiveConfirmationHeaderParam(token);
    expect(result.schema.enum).toStrictEqual([token]);
  });

  test('schema enum changes with different tokens', () => {
    const result1 = destructiveConfirmationHeaderParam('token-a');
    const result2 = destructiveConfirmationHeaderParam('token-b');
    expect(result1.schema.enum).toStrictEqual(['token-a']);
    expect(result2.schema.enum).toStrictEqual(['token-b']);
  });

  test('returns full correct shape', () => {
    const result = destructiveConfirmationHeaderParam('confirm-delete');
    expect(result).toStrictEqual({
      name: 'X-DD-Confirm-Action',
      in: 'header',
      required: true,
      description: 'Confirmation token for destructive action (confirm-delete)',
      schema: {
        type: 'string',
        enum: ['confirm-delete'],
      },
    });
  });
});
