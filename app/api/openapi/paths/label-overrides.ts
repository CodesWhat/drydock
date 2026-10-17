import { containerIdPathParam, errorResponse, jsonResponse } from '../common.js';

const revisionQuery = (minimum: number) => ({
  name: 'revision',
  in: 'query',
  required: true,
  description:
    'The revision the caller last read. A stale revision answers 409 and writes nothing.',
  schema: { type: 'integer', minimum },
});

const overrideIdQuery = {
  name: 'overrideId',
  in: 'query',
  required: false,
  description:
    'The `overrideId` the caller last read. Required when `revision` is above 0: a row deleted ' +
    'and saved again restarts at revision 1, so the id is what tells a stale row from a new one.',
  schema: { type: 'string' },
};

const overrideIdPathParam = {
  name: 'overrideId',
  in: 'path',
  required: true,
  description: 'Label override row identifier',
  schema: { type: 'string' },
};

export const labelOverridePaths = {
  '/api/v1/containers/{id}/label-overrides': {
    get: {
      tags: ['Containers'],
      summary: 'Get the label override snapshot for a container',
      description:
        'Every label-owned field with its declared value, any Drydock override and the effective value with its source.',
      operationId: 'getContainerLabelOverrides',
      parameters: [containerIdPathParam],
      responses: {
        200: jsonResponse('Label override snapshot', {
          $ref: '#/components/schemas/LabelOverrideSnapshot',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing required read scope'),
        404: errorResponse('Container not found'),
        409: errorResponse('The container has no label override scope'),
        500: errorResponse('Unable to read label overrides'),
      },
    },
    patch: {
      tags: ['Containers'],
      summary: 'Set or remove label overrides for a container',
      description:
        'Requires the admin scope. Applies to the container identity, which for a Compose container is every replica of the service. Never edits a Compose file and never recreates or restarts a container.',
      operationId: 'patchContainerLabelOverrides',
      parameters: [containerIdPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LabelOverridePatchRequest' },
          },
        },
      },
      responses: {
        200: jsonResponse('Updated label override snapshot', {
          $ref: '#/components/schemas/LabelOverrideChangeResult',
        }),
        400: jsonResponse('Invalid change or missing override id', {
          $ref: '#/components/schemas/LabelOverrideInvalidRequest',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing required admin scope'),
        404: errorResponse('Container not found'),
        409: jsonResponse('Stale revision or rollback container', {
          $ref: '#/components/schemas/LabelOverrideConflict',
        }),
        413: errorResponse('Request body too large'),
        422: jsonResponse('The dependencies would create a cycle', {
          $ref: '#/components/schemas/LabelOverrideCycle',
        }),
        500: errorResponse('Unable to save label overrides'),
      },
    },
    delete: {
      tags: ['Containers'],
      summary: 'Reset every label override of a container to its labels',
      description: 'Requires the admin scope.',
      operationId: 'resetContainerLabelOverrides',
      parameters: [containerIdPathParam, revisionQuery(0), overrideIdQuery],
      responses: {
        200: jsonResponse('Label override snapshot after the reset', {
          $ref: '#/components/schemas/LabelOverrideChangeResult',
        }),
        400: jsonResponse('Invalid revision or missing override id', {
          $ref: '#/components/schemas/LabelOverrideInvalidRequest',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing required admin scope'),
        404: errorResponse('Container not found'),
        409: jsonResponse('Stale revision, another override row, or rollback container', {
          $ref: '#/components/schemas/LabelOverrideConflict',
        }),
        500: errorResponse('Unable to reset label overrides'),
      },
    },
  },
  '/api/v1/label-overrides': {
    get: {
      tags: ['Containers'],
      summary: 'List every stored label override',
      description:
        'Rows with the containers each one currently matches. An override with no matching container is an orphan.',
      operationId: 'listLabelOverrides',
      responses: {
        200: jsonResponse('Stored label overrides', {
          $ref: '#/components/schemas/LabelOverrideList',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing required read scope'),
        500: errorResponse('Unable to list label overrides'),
      },
    },
  },
  '/api/v1/label-overrides/{overrideId}': {
    delete: {
      tags: ['Containers'],
      summary: 'Delete a stored label override row',
      description: 'Requires the admin scope. Orphans can be deleted too.',
      operationId: 'deleteLabelOverride',
      parameters: [overrideIdPathParam, revisionQuery(1)],
      responses: {
        200: jsonResponse('Deleted label override', {
          $ref: '#/components/schemas/LabelOverrideRowDeleted',
        }),
        400: jsonResponse('Invalid revision', {
          $ref: '#/components/schemas/LabelOverrideInvalidRequest',
        }),
        401: errorResponse('Authentication required'),
        403: errorResponse('Missing required admin scope'),
        404: errorResponse('Label override not found'),
        409: jsonResponse('Stale revision', {
          $ref: '#/components/schemas/LabelOverrideConflict',
        }),
        500: errorResponse('Unable to delete the label override'),
      },
    },
  },
} as const;
