import { describe, expect, test } from 'vitest';
import { errorResponse } from '../common.js';
import { imagePaths } from './images.js';

const IMAGE_HOST_NOT_FOUND_MESSAGE = 'Image host not found';
const IMAGE_HOST_UNSUPPORTED_MESSAGE =
  "Image inventory is not supported over this host's agent connection, typically because the agent has not advertised the usesControllerDockerTransport capability.";
const CONTAINER_ACTIONS_DISABLED_MESSAGE = 'Container actions are disabled';
const AGENT_PRUNE_STILL_RUNNING_MESSAGE =
  "The agent's Docker proxy returned no result; the prune may still be running. Refresh the image list.";

describe('imagePaths', () => {
  test('exports exactly the three expected path keys', () => {
    expect(Object.keys(imagePaths)).toStrictEqual([
      '/api/v1/images',
      '/api/v1/images/prune-preview',
      '/api/v1/images/prune',
    ]);
  });

  describe('/api/v1/images GET', () => {
    const getPath = imagePaths['/api/v1/images'].get;

    test('has tag Images', () => {
      expect(getPath.tags).toStrictEqual(['Images']);
    });

    test('operationId is listImages', () => {
      expect(getPath.operationId).toBe('listImages');
    });

    test('host query parameter is optional', () => {
      const param = getPath.parameters[0];
      expect(param.name).toBe('host');
      expect(param.in).toBe('query');
      expect(param.required).toBe(false);
      expect(param.schema).toStrictEqual({ type: 'string' });
    });

    test('200 response references ImageInventoryResponse', () => {
      expect(getPath.responses[200].content['application/json'].schema).toStrictEqual({
        $ref: '#/components/schemas/ImageInventoryResponse',
      });
    });

    test('401 response is authentication error', () => {
      expect(getPath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
    });

    test('404 response describes host not found', () => {
      expect(getPath.responses[404]).toStrictEqual(errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE));
    });

    test('501 response describes unsupported host', () => {
      expect(getPath.responses[501]).toStrictEqual(errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE));
    });

    test('has no 403, matching the read-scoped list convention (agents, audit, backups)', () => {
      expect(getPath.responses).not.toHaveProperty('403');
    });
  });

  describe('/api/v1/images/prune-preview GET', () => {
    const previewPath = imagePaths['/api/v1/images/prune-preview'].get;

    test('has tag Images', () => {
      expect(previewPath.tags).toStrictEqual(['Images']);
    });

    test('operationId is previewImagePrune', () => {
      expect(previewPath.operationId).toBe('previewImagePrune');
    });

    test('host query parameter is required', () => {
      const param = previewPath.parameters[0];
      expect(param.name).toBe('host');
      expect(param.in).toBe('query');
      expect(param.required).toBe(true);
      expect(param.schema).toStrictEqual({ type: 'string' });
    });

    test('mode query parameter is a required enum', () => {
      const param = previewPath.parameters[1];
      expect(param.name).toBe('mode');
      expect(param.in).toBe('query');
      expect(param.required).toBe(true);
      expect(param.schema).toStrictEqual({ type: 'string', enum: ['dangling', 'unused'] });
    });

    test('200 response references PruneEstimate directly (unwrapped, matches app/api/images.ts)', () => {
      expect(previewPath.responses[200].content['application/json'].schema).toStrictEqual({
        $ref: '#/components/schemas/PruneEstimate',
      });
    });

    test('describes 400, 401, 403, 404, 500, 501, and 504 responses', () => {
      expect(previewPath.responses[400]).toStrictEqual(
        errorResponse('host is required, or mode must be "dangling" or "unused"'),
      );
      expect(previewPath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
      expect(previewPath.responses[403]).toStrictEqual(
        errorResponse(CONTAINER_ACTIONS_DISABLED_MESSAGE),
      );
      expect(previewPath.responses[404]).toStrictEqual(errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE));
      expect(previewPath.responses[500]).toStrictEqual(
        errorResponse('Unable to estimate reclaimable space'),
      );
      expect(previewPath.responses[501]).toStrictEqual(
        errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE),
      );
      expect(previewPath.responses[504]).toStrictEqual(
        errorResponse(AGENT_PRUNE_STILL_RUNNING_MESSAGE),
      );
    });
  });

  describe('/api/v1/images/prune POST', () => {
    const prunePath = imagePaths['/api/v1/images/prune'].post;

    test('has tags Images and Actions', () => {
      expect(prunePath.tags).toStrictEqual(['Images', 'Actions']);
    });

    test('operationId is pruneImages', () => {
      expect(prunePath.operationId).toBe('pruneImages');
    });

    test('requires the destructive confirmation header for image-prune', () => {
      const param = prunePath.parameters[0];
      expect(param.name).toBe('X-DD-Confirm-Action');
      expect(param.in).toBe('header');
      expect(param.required).toBe(true);
      expect(param.schema).toStrictEqual({ type: 'string', enum: ['image-prune'] });
    });

    test('request body requires host and mode, no additional properties', () => {
      const schema = prunePath.requestBody.content['application/json'].schema as {
        required: string[];
        additionalProperties: boolean;
        properties: { mode: { enum: string[] } };
      };
      expect(prunePath.requestBody.required).toBe(true);
      expect(schema.required).toStrictEqual(['host', 'mode']);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.mode.enum).toStrictEqual(['dangling', 'unused']);
    });

    test('200 response references ImagePruneResponse', () => {
      expect(prunePath.responses[200].content['application/json'].schema).toStrictEqual({
        $ref: '#/components/schemas/ImagePruneResponse',
      });
    });

    test('describes 400, 401, 403, 404, 428, 500, 501, and 504 responses', () => {
      expect(prunePath.responses[400]).toStrictEqual(
        errorResponse('host is required, or mode must be "dangling" or "unused"'),
      );
      expect(prunePath.responses[401]).toStrictEqual(errorResponse('Authentication required'));
      expect(prunePath.responses[403]).toStrictEqual(
        errorResponse(CONTAINER_ACTIONS_DISABLED_MESSAGE),
      );
      expect(prunePath.responses[404]).toStrictEqual(errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE));
      expect(prunePath.responses[428]).toStrictEqual(
        errorResponse('Destructive confirmation header is required'),
      );
      expect(prunePath.responses[500]).toStrictEqual(errorResponse('Image prune failed'));
      expect(prunePath.responses[501]).toStrictEqual(errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE));
      expect(prunePath.responses[504]).toStrictEqual(
        errorResponse(AGENT_PRUNE_STILL_RUNNING_MESSAGE),
      );
    });
  });
});
