import { errorResponse, jsonResponse, paginationQueryParams } from '../common.js';

const approvalIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Approval identifier',
  schema: { type: 'string' },
};

export const approvalPaths = {
  '/api/v1/approvals': {
    get: {
      tags: ['Approvals'],
      summary: 'List update approvals',
      description:
        'Update candidates awaiting an operator, newest first. A row exists for exactly ' +
        'the candidate set that renders an enabled Update button and will not be applied ' +
        'automatically; a soft blocker (snooze, threshold, maturity, skip) holds a row in ' +
        'the queue rather than hiding it.',
      operationId: 'listApprovals',
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          description: 'Filter by queue status (defaults to pending)',
          schema: { type: 'string', enum: ['pending', 'deferred', 'decided', 'all'] },
        },
        {
          name: 'containerId',
          in: 'query',
          required: false,
          description: 'Filter by container identifier',
          schema: { type: 'string' },
        },
        {
          name: 'agent',
          in: 'query',
          required: false,
          description: 'Filter by the agent that owns the container',
          schema: { type: 'string' },
        },
        {
          name: 'semverDiff',
          in: 'query',
          required: false,
          description: 'Filter by the size of the version change',
          schema: {
            type: 'string',
            enum: ['major', 'minor', 'patch', 'prerelease', 'unknown'],
          },
        },
        {
          name: 'q',
          in: 'query',
          required: false,
          description: 'Free-text match on container name, image, and the from/to refs',
          schema: { type: 'string', maxLength: 200 },
        },
        ...paginationQueryParams,
      ],
      responses: {
        200: jsonResponse('Approval rows', {
          $ref: '#/components/schemas/ApprovalListResult',
        }),
        400: errorResponse('Invalid query parameter'),
        401: errorResponse('Authentication required'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/approvals/summary': {
    get: {
      tags: ['Approvals'],
      summary: 'Count approvals by queue state',
      operationId: 'getApprovalSummary',
      responses: {
        200: jsonResponse('Approval counts', {
          $ref: '#/components/schemas/ApprovalSummary',
        }),
        401: errorResponse('Authentication required'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/approvals/{id}': {
    get: {
      tags: ['Approvals'],
      summary: 'Get an approval with its live eligibility',
      operationId: 'getApproval',
      parameters: [approvalIdPathParam],
      responses: {
        200: jsonResponse('Approval detail', {
          $ref: '#/components/schemas/ApprovalDetail',
        }),
        401: errorResponse('Authentication required'),
        404: errorResponse('Approval not found'),
        500: errorResponse('Internal server error'),
      },
    },
  },
} as const;
