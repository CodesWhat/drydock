import appPackageJson from '../package.json';
import { errorResponse, jsonResponse, paginationQueryParams } from './openapi/common.js';
import { openApiDocument as openApiDocumentFromIndex } from './openapi/index.js';
import { openApiDocument } from './openapi.js';

describe('OpenAPI document', () => {
  test('should expose the same OpenAPI document through the decomposed module entrypoint', () => {
    expect(openApiDocumentFromIndex).toBe(openApiDocument);
  });

  test('should declare OpenAPI 3.1 and include representative API paths', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.info.version).toBe(appPackageJson.version);
    expect(openApiDocument.paths['/api/openapi.json']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/debug/dump']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/containers/{id}/scan']?.post).toBeDefined();
    expect(openApiDocument.paths['/api/containers/{id}/stats']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/webhook/watch']?.post).toBeDefined();
    expect(openApiDocument.paths['/auth/login']?.post).toBeDefined();
  });

  test('should define session, webhook, and metrics bearer security schemes', () => {
    expect(openApiDocument.components.securitySchemes.sessionAuth).toBeDefined();
    expect(openApiDocument.components.securitySchemes.webhookBearerAuth).toBeDefined();
    expect(openApiDocument.components.securitySchemes.metricsBearerAuth).toBeDefined();
    expect(openApiDocument.components.securitySchemes.metricsBearerAuth.type).toBe('http');
    expect(openApiDocument.components.securitySchemes.metricsBearerAuth.scheme).toBe('bearer');
  });

  test('should keep webhook endpoints protected by bearer auth in the spec', () => {
    expect(openApiDocument.paths['/api/webhook/watch']?.post?.security).toStrictEqual([
      { webhookBearerAuth: [] },
    ]);
  });

  test('should declare /metrics with bearer token and session security alternatives', () => {
    expect(openApiDocument.paths['/metrics']?.get?.security).toStrictEqual([
      { metricsBearerAuth: [] },
      { sessionAuth: [] },
    ]);
  });

  test('should model action and webhook success payloads with a result envelope', () => {
    expect(openApiDocument.components.schemas.ContainerActionResponse).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
        result: { $ref: '#/components/schemas/ContainerResource' },
      },
    });
    expect(
      openApiDocument.components.schemas.ContainerActionResponse.properties.container,
    ).toBeUndefined();

    expect(openApiDocument.components.schemas.WebhookWatchAllResponse).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            watchers: { type: 'integer', minimum: 0 },
          },
          required: ['watchers'],
          additionalProperties: false,
        },
      },
      required: ['message', 'result'],
    });

    expect(openApiDocument.components.schemas.WebhookContainerActionResponse).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            container: { type: 'string' },
          },
          required: ['container'],
          additionalProperties: false,
        },
      },
      required: ['message', 'result'],
    });
  });

  test('should document accepted container updates with an operation id response', () => {
    expect(openApiDocument.components.schemas.ContainerUpdateAcceptedResponse).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
        operationId: { type: 'string' },
      },
      required: ['message', 'operationId'],
    });

    expect(openApiDocument.paths['/api/containers/{id}/update']?.post?.responses?.[202]).toEqual(
      jsonResponse('Container update accepted', {
        $ref: '#/components/schemas/ContainerUpdateAcceptedResponse',
      }),
    );
  });

  test('should expose PATCH /api/settings and keep PUT as deprecated compatibility alias', () => {
    expect(openApiDocument.paths['/api/settings']?.patch).toBeDefined();
    expect(openApiDocument.paths['/api/settings']?.put).toBeDefined();
    expect(openApiDocument.paths['/api/settings']?.put?.deprecated).toBe(true);
  });

  test('should document the bulk container update endpoint', () => {
    expect(openApiDocument.components.schemas.ContainerBulkUpdateResponse).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
        accepted: { type: 'array' },
        rejected: { type: 'array' },
      },
      required: ['message', 'accepted', 'rejected'],
    });

    expect(openApiDocument.paths['/api/containers/update']?.post?.responses?.[200]).toEqual(
      jsonResponse('Container update requests processed', {
        $ref: '#/components/schemas/ContainerBulkUpdateResponse',
      }),
    );
  });

  test('should document compose-specific preview metadata while keeping base preview fields', () => {
    const previewSchema = openApiDocument.components.schemas.PreviewResponse;

    expect(previewSchema).toMatchObject({
      type: 'object',
      properties: {
        containerName: { type: 'string' },
        currentImage: { type: 'string' },
        newImage: { type: 'string' },
        compose: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
            },
            paths: {
              type: 'array',
              items: { type: 'string' },
            },
            service: { type: 'string' },
            mutation: {
              type: 'object',
              properties: {
                intent: { type: 'string' },
                dryRun: { type: 'boolean' },
                willWrite: { type: 'boolean' },
              },
            },
          },
        },
      },
    });
  });

  test('should keep agent-scoped component routes with agent as the final path segment', () => {
    expect(openApiDocument.paths['/api/triggers/{type}/{name}/{agent}']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/triggers/{agent}/{type}/{name}']).toBeUndefined();
    expect(
      openApiDocument.paths[
        '/api/containers/{id}/triggers/{triggerType}/{triggerName}/{triggerAgent}'
      ]?.post,
    ).toBeDefined();
    expect(
      openApiDocument.paths[
        '/api/containers/{id}/triggers/{triggerAgent}/{triggerType}/{triggerName}'
      ],
    ).toBeUndefined();
    expect(openApiDocument.paths['/api/watchers/{type}/{name}/{agent}']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/watchers/{agent}/{type}/{name}']).toBeUndefined();
    expect(openApiDocument.paths['/api/registries/{type}/{name}/{agent}']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/registries/{agent}/{type}/{name}']).toBeUndefined();
    expect(openApiDocument.paths['/api/authentications/{type}/{name}/{agent}']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/authentications/{agent}/{type}/{name}']).toBeUndefined();
  });

  test('should describe component collection endpoints with pagination and auth errors', () => {
    const componentCollections = [
      {
        path: '/api/watchers',
        tag: 'Watchers',
        nounPlural: 'watchers',
        operationId: 'watcherList',
      },
      {
        path: '/api/registries',
        tag: 'Registries',
        nounPlural: 'registries',
        operationId: 'registryList',
      },
      {
        path: '/api/authentications',
        tag: 'Authentications',
        nounPlural: 'authentications',
        operationId: 'authenticationList',
      },
    ] as const;

    for (const { path, tag, nounPlural, operationId } of componentCollections) {
      expect(openApiDocument.paths[path]?.get).toStrictEqual({
        tags: [tag],
        summary: `List ${nounPlural}`,
        operationId,
        parameters: paginationQueryParams,
        responses: {
          200: jsonResponse(`List of ${nounPlural}`, {
            $ref: '#/components/schemas/PaginatedResult',
          }),
          401: errorResponse('Authentication required'),
        },
      });
    }
  });

  test('should avoid GenericObject for successful JSON responses', () => {
    const offenders: string[] = [];
    const methodNames = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const method of methodNames) {
        const operation = (pathItem as Record<string, unknown>)[method] as
          | {
              responses?: Record<string, unknown>;
            }
          | undefined;
        if (!operation?.responses) {
          continue;
        }

        for (const [statusCode, response] of Object.entries(operation.responses)) {
          if (!statusCode.startsWith('2')) {
            continue;
          }

          const schema = (
            (response as { content?: Record<string, { schema?: unknown }> }).content?.[
              'application/json'
            ] || {}
          ).schema as { $ref?: string } | undefined;
          if (schema?.$ref === '#/components/schemas/GenericObject') {
            offenders.push(`${method.toUpperCase()} ${path} (${statusCode})`);
          }
        }
      }
    }

    expect(offenders).toStrictEqual([]);
  });

  test('should model non-paginated collection endpoints with CollectionResult envelopes', () => {
    const collectionPaths = [
      '/api/containers/{id}/backups',
      '/api/containers/{id}/triggers',
      '/api/containers/{id}/update-operations',
      '/api/agents',
      '/api/notifications',
    ] as const;

    for (const path of collectionPaths) {
      const schema =
        openApiDocument.paths[path]?.get?.responses?.['200']?.content?.['application/json']?.schema;
      expect(schema).toEqual({ $ref: '#/components/schemas/CollectionResult' });
    }
  });

  test('should compose auth, container, and trigger paths from domain modules', async () => {
    const [{ authPaths }, { containerPaths }, { triggerPaths }, { openApiPaths }] =
      await Promise.all([
        import('./openapi/paths/auth.js'),
        import('./openapi/paths/containers.js'),
        import('./openapi/paths/triggers.js'),
        import('./openapi/paths/index.js'),
      ]);

    expect(openApiPaths['/auth/login']).toBe(authPaths['/auth/login']);
    expect(openApiPaths['/api/containers']).toBe(containerPaths['/api/containers']);
    expect(openApiPaths['/api/triggers']).toBe(triggerPaths['/api/triggers']);
  });
});
