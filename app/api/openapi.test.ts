import { openApiDocument } from './openapi.js';

describe('OpenAPI document', () => {
  test('should declare OpenAPI 3.1 and include representative API paths', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.paths['/api/openapi.json']?.get).toBeDefined();
    expect(openApiDocument.paths['/api/containers/{id}/scan']?.post).toBeDefined();
    expect(openApiDocument.paths['/api/webhook/watch']?.post).toBeDefined();
    expect(openApiDocument.paths['/auth/login']?.post).toBeDefined();
  });

  test('should define session and webhook security schemes', () => {
    expect(openApiDocument.components.securitySchemes.sessionAuth).toBeDefined();
    expect(openApiDocument.components.securitySchemes.webhookBearerAuth).toBeDefined();
  });

  test('should keep webhook endpoints protected by bearer auth in the spec', () => {
    expect(openApiDocument.paths['/api/webhook/watch']?.post?.security).toStrictEqual([
      { webhookBearerAuth: [] },
    ]);
  });

  test('should expose PATCH /api/settings and keep PUT as deprecated compatibility alias', () => {
    expect(openApiDocument.paths['/api/settings']?.patch).toBeDefined();
    expect(openApiDocument.paths['/api/settings']?.put).toBeDefined();
    expect(openApiDocument.paths['/api/settings']?.put?.deprecated).toBe(true);
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
});
