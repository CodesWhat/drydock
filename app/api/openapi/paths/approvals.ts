import { errorResponse, jsonResponse, paginationQueryParams } from '../common.js';

const decisionNoteProperty = {
  note: {
    type: 'string',
    maxLength: 500,
    description: 'Free-text reason recorded on the row and in the audit entry',
  },
};

const decisionRequestBody = {
  required: false,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { ...decisionNoteProperty },
        additionalProperties: false,
      },
    },
  },
};

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
  '/api/v1/approvals/{id}/approve': {
    post: {
      tags: ['Approvals', 'Actions'],
      summary: 'Approve a queued update',
      description:
        'Dispatches through the same admission path POST /api/v1/containers/{id}/update ' +
        'uses and returns the same responses, so an approve inherits every rejection that ' +
        'endpoint has — including the 409 under update mode notify. Admission is ' +
        're-evaluated now, not when the row was sighted. A second concurrent approve gets ' +
        '409 and no second operation is created.',
      operationId: 'approveApproval',
      parameters: [approvalIdPathParam],
      requestBody: decisionRequestBody,
      responses: {
        202: jsonResponse('Container update accepted', {
          $ref: '#/components/schemas/ContainerUpdateAcceptedResponse',
        }),
        400: errorResponse(
          'Invalid request body or note, or no update available for this container',
        ),
        401: errorResponse('Authentication required'),
        403: errorResponse('Container actions feature disabled'),
        404: errorResponse('Approval or container not found'),
        409: errorResponse(
          'Approval already decided, its candidate was superseded, update mode is notify, ' +
            'or the update is blocked',
        ),
        500: errorResponse('Unable to accept container update'),
      },
    },
  },
  '/api/v1/approvals/{id}/reject': {
    post: {
      tags: ['Approvals', 'Actions'],
      summary: 'Reject a queued update',
      description:
        "Adds the candidate to the container's skipTags or skipDigests — the same " +
        "operation as the container detail panel's Skip button, undoable from the " +
        'update-policy panel — and resolves the row as rejected.',
      operationId: 'rejectApproval',
      parameters: [approvalIdPathParam],
      requestBody: decisionRequestBody,
      responses: {
        200: jsonResponse('Approval rejected', {
          $ref: '#/components/schemas/ApprovalDecisionResult',
        }),
        400: errorResponse('Invalid request body or note, or no current update available to skip'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Approval or container not found'),
        409: errorResponse('Approval already decided, or its candidate was superseded'),
        500: errorResponse('Internal server error'),
      },
    },
  },
  '/api/v1/approvals/{id}/defer': {
    post: {
      tags: ['Approvals', 'Actions'],
      summary: 'Defer a queued update',
      description:
        "Snoozes the container until the given instant and mirrors it onto the row's " +
        'deferredUntil, so the queue and the snoozed soft blocker cannot disagree about ' +
        'when the hold ends. There is no sweep job: a row is deferred while deferredUntil ' +
        'is in the future and pending again the moment it is not.',
      operationId: 'deferApproval',
      parameters: [approvalIdPathParam],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                until: {
                  type: 'string',
                  format: 'date-time',
                  description:
                    'Explicit expiry, as an RFC 3339 date-time with an offset. Must be in ' +
                    'the future and at most 365 days from now, the same ceiling days has. ' +
                    'Takes precedence over days.',
                },
                days: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 365,
                  description: 'Days from now. Defaults to 7 when neither field is given.',
                },
                ...decisionNoteProperty,
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        200: jsonResponse('Approval deferred', {
          $ref: '#/components/schemas/ApprovalDecisionResult',
        }),
        400: errorResponse('Invalid request body, note, until date, or day count'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Approval or container not found'),
        409: errorResponse('Approval already decided, or its candidate was superseded'),
        500: errorResponse('Internal server error'),
      },
    },
  },
} as const;
