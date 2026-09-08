import { destructiveConfirmationHeaderParam, errorResponse, jsonResponse } from '../common.js';

const IMAGE_HOST_NOT_FOUND_MESSAGE = 'Image host not found';
const IMAGE_HOST_UNSUPPORTED_MESSAGE =
  "Image inventory is not supported over this host's agent connection, typically because the agent has not advertised the usesControllerDockerTransport capability.";
const CONTAINER_ACTIONS_DISABLED_MESSAGE = 'Container actions are disabled';
const AGENT_PRUNE_STILL_RUNNING_MESSAGE =
  'Prune is still running on this host; refresh the image list';

const imageHostQueryParam = {
  name: 'host',
  in: 'query',
  required: false,
  description: 'Image host id to scope inventory to; omit to list images across every host',
  schema: { type: 'string' },
} as const;

const imageHostQueryParamRequired = {
  name: 'host',
  in: 'query',
  required: true,
  description: 'Image host id to compute the prune estimate for',
  schema: { type: 'string' },
} as const;

const imageModeQueryParam = {
  name: 'mode',
  in: 'query',
  required: true,
  description:
    'Prune mode: "dangling" (untagged, unreferenced images only) or "unused" (any image with no containers)',
  schema: { type: 'string', enum: ['dangling', 'unused'] },
} as const;

const imagePruneRequestBody = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          mode: { type: 'string', enum: ['dangling', 'unused'] },
        },
        required: ['host', 'mode'],
        additionalProperties: false,
      },
    },
  },
} as const;

export const imagePaths = {
  '/api/v1/images': {
    get: {
      tags: ['Images'],
      summary: 'List image inventory across image hosts',
      description:
        'A per-host fetch failure is isolated to that host\'s entry in "hosts" (error set, no images contributed) rather than failing the whole request.',
      operationId: 'listImages',
      parameters: [imageHostQueryParam],
      responses: {
        200: jsonResponse('Image inventory', {
          $ref: '#/components/schemas/ImageInventoryResponse',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE),
        501: errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE),
      },
    },
  },
  '/api/v1/images/prune-preview': {
    get: {
      tags: ['Images'],
      summary: 'Preview what a prune would reclaim without deleting anything',
      operationId: 'previewImagePrune',
      parameters: [imageHostQueryParamRequired, imageModeQueryParam],
      responses: {
        200: jsonResponse('Prune estimate', {
          $ref: '#/components/schemas/PruneEstimate',
        }),
        400: errorResponse('host is required, or mode must be "dangling" or "unused"'),
        401: errorResponse('Authentication required'),
        403: errorResponse(CONTAINER_ACTIONS_DISABLED_MESSAGE),
        404: errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE),
        501: errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE),
        500: errorResponse('Unable to estimate reclaimable space'),
        504: errorResponse(AGENT_PRUNE_STILL_RUNNING_MESSAGE),
      },
    },
  },
  '/api/v1/images/prune': {
    post: {
      tags: ['Images', 'Actions'],
      summary: 'Prune images on an image host',
      operationId: 'pruneImages',
      parameters: [destructiveConfirmationHeaderParam('image-prune')],
      requestBody: imagePruneRequestBody,
      responses: {
        200: jsonResponse('Prune result', {
          $ref: '#/components/schemas/ImagePruneResponse',
        }),
        400: errorResponse('host is required, or mode must be "dangling" or "unused"'),
        401: errorResponse('Authentication required'),
        403: errorResponse(CONTAINER_ACTIONS_DISABLED_MESSAGE),
        404: errorResponse(IMAGE_HOST_NOT_FOUND_MESSAGE),
        428: errorResponse('Destructive confirmation header is required'),
        501: errorResponse(IMAGE_HOST_UNSUPPORTED_MESSAGE),
        500: errorResponse('Image prune failed'),
        504: errorResponse(AGENT_PRUNE_STILL_RUNNING_MESSAGE),
      },
    },
  },
} as const;
