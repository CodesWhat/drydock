import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
  paginationQueryParams,
} from '../common.js';
import { componentReadPaths } from './component-read.js';

describe('componentReadPaths', () => {
  test('should describe component collection endpoints with tags, pagination, and auth errors', () => {
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
      expect(componentReadPaths[path]?.get).toStrictEqual({
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

  test('should describe component detail endpoints for local and agent-scoped lookups', () => {
    const componentDetails = [
      {
        basePath: '/api/watchers',
        tag: 'Watchers',
        nounSingular: 'watcher',
        operationPrefix: 'watcher',
      },
      {
        basePath: '/api/registries',
        tag: 'Registries',
        nounSingular: 'registry',
        operationPrefix: 'registry',
      },
      {
        basePath: '/api/authentications',
        tag: 'Authentications',
        nounSingular: 'authentication',
        operationPrefix: 'authentication',
      },
    ] as const;

    for (const { basePath, tag, nounSingular, operationPrefix } of componentDetails) {
      expect(componentReadPaths[`${basePath}/{type}/{name}`]?.get).toStrictEqual({
        tags: [tag],
        summary: `Get ${nounSingular} by type and name`,
        operationId: `${operationPrefix}GetByTypeAndName`,
        parameters: [componentTypePathParam, componentNamePathParam],
        responses: {
          200: jsonResponse(`${nounSingular} details`, {
            $ref: '#/components/schemas/ComponentItem',
          }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${nounSingular} not found`),
        },
      });

      expect(componentReadPaths[`${basePath}/{type}/{name}/{agent}`]?.get).toStrictEqual({
        tags: [tag],
        summary: `Get remote ${nounSingular} by type, name, and agent`,
        operationId: `${operationPrefix}GetByTypeAndNameAndAgent`,
        parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
        responses: {
          200: jsonResponse(`${nounSingular} details`, {
            $ref: '#/components/schemas/ComponentItem',
          }),
          401: errorResponse('Authentication required'),
          404: errorResponse(`${nounSingular} not found`),
        },
      });
    }
  });
});
