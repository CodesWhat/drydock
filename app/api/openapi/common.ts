export const genericObjectSchema = { type: 'object', additionalProperties: true };
export const genericArraySchema = {
  type: 'array',
  items: { ...genericObjectSchema },
};
export const emptyObjectSchema = { type: 'object', additionalProperties: false };
type JsonSchema = { $ref: string } | Record<string, unknown>;

export const jsonContent = (schema: JsonSchema) => ({
  'application/json': { schema },
});

export const jsonResponse = (description: string, schema: JsonSchema) => ({
  description,
  content: jsonContent(schema),
});

export const errorResponse = (description: string) => ({
  description,
  content: jsonContent({ $ref: '#/components/schemas/ErrorResponse' }),
});

export const noContentResponse = {
  description: 'No content',
};

export const containerIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Container identifier',
  schema: { type: 'string' },
};

export const componentTypePathParam = {
  name: 'type',
  in: 'path',
  required: true,
  description: 'Component type',
  schema: { type: 'string' },
};

export const componentNamePathParam = {
  name: 'name',
  in: 'path',
  required: true,
  description: 'Component name',
  schema: { type: 'string' },
};

export const componentAgentPathParam = {
  name: 'agent',
  in: 'path',
  required: true,
  description: 'Agent name',
  schema: { type: 'string' },
};

export const triggerTypePathParam = {
  name: 'triggerType',
  in: 'path',
  required: true,
  description: 'Trigger type',
  schema: { type: 'string' },
};

export const triggerNamePathParam = {
  name: 'triggerName',
  in: 'path',
  required: true,
  description: 'Trigger name',
  schema: { type: 'string' },
};

export const triggerAgentPathParam = {
  name: 'triggerAgent',
  in: 'path',
  required: true,
  description: 'Trigger agent name',
  schema: { type: 'string' },
};

export const agentNamePathParam = {
  name: 'name',
  in: 'path',
  required: true,
  description: 'Agent name',
  schema: { type: 'string' },
};

export const operationIdPathParam = {
  name: 'operationId',
  in: 'path',
  required: true,
  description: 'Self-update operation identifier',
  schema: { type: 'string' },
};

export const containerNamePathParam = {
  name: 'containerName',
  in: 'path',
  required: true,
  description: 'Container name',
  schema: { type: 'string' },
};

export const iconProviderPathParam = {
  name: 'provider',
  in: 'path',
  required: true,
  description: 'Icon provider name',
  schema: { type: 'string' },
};

export const iconSlugPathParam = {
  name: 'slug',
  in: 'path',
  required: true,
  description: 'Icon slug',
  schema: { type: 'string' },
};

export const notificationRuleIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Notification rule identifier',
  schema: { type: 'string' },
};

export const paginationQueryParams = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Max number of items to return (0-200)',
    schema: { type: 'integer', minimum: 0, maximum: 200 },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    description: 'Offset into results list',
    schema: { type: 'integer', minimum: 0 },
  },
];

export const containerListQueryParams = [
  ...paginationQueryParams,
  {
    name: 'includeVulnerabilities',
    in: 'query',
    required: false,
    description: 'When true, include full vulnerability arrays in container payloads',
    schema: { type: 'boolean' },
  },
];
