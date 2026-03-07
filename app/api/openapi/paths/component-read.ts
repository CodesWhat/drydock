import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
  paginationQueryParams,
} from '../common.js';

function createComponentReadOperations(options: {
  basePath: string;
  tag: string;
  nounPlural: string;
  nounSingular: string;
  operationPrefix: string;
}) {
  const { basePath, tag, nounPlural, nounSingular, operationPrefix } = options;
  return {
    [basePath]: {
      get: {
        tags: [tag],
        summary: `List ${nounPlural}`,
        operationId: `${operationPrefix}List`,
        parameters: paginationQueryParams,
        responses: {
          200: jsonResponse(`List of ${nounPlural}`, {
            $ref: '#/components/schemas/PaginatedResult',
          }),
          401: errorResponse('Authentication required'),
        },
      },
    },
    [`${basePath}/{type}/{name}`]: {
      get: {
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
      },
    },
    [`${basePath}/{type}/{name}/{agent}`]: {
      get: {
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
      },
    },
  };
}

export const componentReadPaths = {
  ...createComponentReadOperations({
    basePath: '/api/watchers',
    tag: 'Watchers',
    nounPlural: 'watchers',
    nounSingular: 'watcher',
    operationPrefix: 'watcher',
  }),
  ...createComponentReadOperations({
    basePath: '/api/registries',
    tag: 'Registries',
    nounPlural: 'registries',
    nounSingular: 'registry',
    operationPrefix: 'registry',
  }),
  ...createComponentReadOperations({
    basePath: '/api/authentications',
    tag: 'Authentications',
    nounPlural: 'authentications',
    nounSingular: 'authentication',
    operationPrefix: 'authentication',
  }),
};
