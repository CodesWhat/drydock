import { describe, expect, test } from 'vitest';
import {
  componentAgentPathParam,
  componentNamePathParam,
  componentTypePathParam,
  errorResponse,
  jsonResponse,
} from '../common.js';
import { triggerPaths } from './triggers.js';

describe('triggerPaths', () => {
  test('local trigger execution documents synchronous and update-accepted responses', () => {
    expect(triggerPaths['/api/triggers/{type}/{name}'].post.responses).toStrictEqual({
      200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
      202: jsonResponse('Update operation accepted', {
        $ref: '#/components/schemas/OperationAcceptedResponse',
      }),
      400: errorResponse('Invalid trigger request'),
      401: errorResponse('Authentication required'),
      404: errorResponse('Trigger not found'),
      409: errorResponse('Update cannot be queued'),
      500: errorResponse('Trigger execution failed'),
    });
  });

  test('remote trigger execution documents update-accepted and ownership conflict responses', () => {
    expect(triggerPaths['/api/triggers/{type}/{name}/{agent}'].post).toMatchObject({
      tags: ['Triggers', 'Actions'],
      summary: 'Run remote trigger for a provided container payload',
      operationId: 'runRemoteTrigger',
      parameters: [componentTypePathParam, componentNamePathParam, componentAgentPathParam],
      responses: {
        200: jsonResponse('Trigger executed', { $ref: '#/components/schemas/EmptyObject' }),
        202: jsonResponse('Update operation accepted', {
          $ref: '#/components/schemas/OperationAcceptedResponse',
        }),
        400: errorResponse('Invalid trigger request'),
        401: errorResponse('Authentication required'),
        404: errorResponse('Agent not found'),
        409: errorResponse('Update cannot be queued or route agent does not own container'),
        500: errorResponse('Trigger execution failed'),
      },
    });
  });
});
