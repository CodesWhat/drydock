import { openApiDocument } from './index.js';

test.each([
  '/api/v1/watchers/{type}/{name}/inventory',
  '/api/v1/watchers/{type}/{name}/{agent}/inventory',
])('documents the additive inventory contract at %s', (path) => {
  const operation = (openApiDocument.paths as Record<string, any>)[path]?.post;
  expect(operation).toBeDefined();
  expect(operation.requestBody.content['application/json'].schema).toEqual({
    type: 'object',
    additionalProperties: false,
  });
  expect(Object.keys(operation.responses)).toEqual([
    '200',
    '400',
    '401',
    '403',
    '404',
    '500',
    '501',
    '503',
    '504',
  ]);
  const result = operation.responses[200].content['application/json'].schema;
  expect(result.required).toEqual([
    'context',
    'containers',
    'removedIds',
    'errors',
    'authoritative',
  ]);
  expect(result.properties.context.properties.operationId).toEqual({
    type: 'string',
    format: 'uuid',
  });
  expect(result.properties.containers.items).toEqual({
    $ref: '#/components/schemas/ContainerResource',
  });
});
