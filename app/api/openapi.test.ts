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
});
