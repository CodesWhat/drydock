import { openApiSchemas } from './schemas.js';

describe('scanner runtime OpenAPI schemas', () => {
  test('documents each runtime provider with its tool status, provider, and role', () => {
    expect(openApiSchemas.SecurityRuntimeProviderStatus).toStrictEqual({
      type: 'object',
      allOf: [
        { $ref: '#/components/schemas/SecurityRuntimeToolStatus' },
        {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['trivy', 'grype', 'syft'] },
            role: { type: 'string', enum: ['scanner', 'sbom'] },
          },
          required: ['provider', 'role'],
          additionalProperties: true,
        },
      ],
    });

    expect(openApiSchemas.SecurityRuntimeStatusResponse.properties.providers).toStrictEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/SecurityRuntimeProviderStatus' },
    });
  });

  test('documents scanner selection and every scanner asset lifecycle field', () => {
    expect(
      openApiSchemas.SecurityRuntimeStatusResponse.properties.scanner.allOf[1].properties.scanner,
    ).toStrictEqual({ type: 'string', enum: ['', 'trivy', 'grype', 'both'] });

    expect(openApiSchemas.ScannerAssetStatus).toStrictEqual({
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['trivy', 'grype', 'syft'] },
        backend: { type: 'string', enum: ['command', 'docker', 'remote'] },
        configuredImage: { type: 'string' },
        resolvedDigest: { type: 'string' },
        version: { type: 'string' },
        state: {
          type: 'string',
          enum: ['missing', 'pulling', 'warming', 'ready', 'error'],
        },
        operationId: { type: 'string' },
        inspectedAt: { type: 'string', format: 'date-time' },
        startedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        cacheUpdatedAt: { type: 'string', format: 'date-time' },
        databaseUpdatedAt: { type: 'string', format: 'date-time' },
        lastError: { type: 'string' },
      },
      required: ['provider', 'backend', 'configuredImage', 'state'],
      additionalProperties: true,
    });
  });
});
