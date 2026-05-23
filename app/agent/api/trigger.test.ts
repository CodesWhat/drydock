import { beforeEach, describe, expect, test } from 'vitest';
import { mapComponentsToList } from '../../api/component.js';
import * as apiTrigger from '../../api/trigger.js';
import * as registry from '../../registry/index.js';
import * as triggerApi from './trigger.js';

const { mockLoggerChild, mockLogError } = vi.hoisted(() => ({
  mockLoggerChild: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: mockLoggerChild.mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: mockLogError,
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../registry/index.js', () => ({
  getState: vi.fn(),
}));

vi.mock('../../api/trigger.js', () => ({
  runTrigger: vi.fn(),
}));

vi.mock('../../api/component.js', () => ({
  mapComponentsToList: vi.fn().mockReturnValue([]),
}));

describe('agent API trigger', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {}, body: {} };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
  });

  describe('getTriggers', () => {
    test('should return list of triggers', () => {
      const triggers = { 'docker.update': {} };
      registry.getState.mockReturnValue({ trigger: triggers });
      triggerApi.getTriggers(req, res);
      expect(mapComponentsToList).toHaveBeenCalledWith(triggers, 'trigger');
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('runTrigger', () => {
    test('should strip agent field from body and delegate to api trigger', async () => {
      req.body = { id: 'c1', agent: 'remote-agent' };
      await triggerApi.runTrigger(req, res);
      expect(req.body.agent).toBeUndefined();
      expect(apiTrigger.runTrigger).toHaveBeenCalledWith(req, res);
    });

    test('should handle body without agent field', async () => {
      req.body = { id: 'c1' };
      await triggerApi.runTrigger(req, res);
      expect(apiTrigger.runTrigger).toHaveBeenCalledWith(req, res);
    });

    test('should handle null body', async () => {
      req.body = null;
      await triggerApi.runTrigger(req, res);
      expect(apiTrigger.runTrigger).toHaveBeenCalledWith(req, res);
    });
  });

  describe('runTriggerBatch', () => {
    test('should return 400 when body is not an array', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = { not: 'array' };
      await triggerApi.runTriggerBatch(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    test('should return 404 when trigger is not found', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      registry.getState.mockReturnValue({ trigger: {} });
      await triggerApi.runTriggerBatch(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should call triggerBatch and strip agent fields', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1', agent: 'remote' }, { id: 'c2' }];
      const mockTrigger = { triggerBatch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith(
        [{ id: 'c1' }, { id: 'c2' }],
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should extract operationId fields and pass as runtimeContext (#289)', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [
        { id: 'c1', operationId: 'op-uuid-1', agent: 'remote' },
        { id: 'c2', operationId: 'op-uuid-2' },
      ];
      const mockTrigger = { triggerBatch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith([{ id: 'c1' }, { id: 'c2' }], {
        operationIds: { c1: 'op-uuid-1', c2: 'op-uuid-2' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should pass undefined runtimeContext when no container has operationId (#289)', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }, { id: 'c2' }];
      const mockTrigger = { triggerBatch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith(
        [{ id: 'c1' }, { id: 'c2' }],
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should ignore empty-string operationId and not include in runtimeContext (#289)', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [
        { id: 'c1', operationId: '' },
        { id: 'c2', operationId: 'op-uuid-2' },
      ];
      const mockTrigger = { triggerBatch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      // c1 has empty-string operationId — skipped; only c2 contributes
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith(
        [{ id: 'c1', operationId: '' }, { id: 'c2' }],
        { operationIds: { c2: 'op-uuid-2' } },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 500 when trigger throws', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(new Error('trigger failed')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Error when running batch trigger docker.update' }),
      );
    });

    test('should return default 500 message when trigger throws non-object error', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(42),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal Server Error' }),
      );
    });

    test('should include trigger type and name in 500 error response when message available', async () => {
      req.params = { type: 'slack', name: 'myslack' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(new Error('trigger failed hard')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'slack.myslack': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('slack.myslack'),
        }),
      );
    });

    test('should include error details reason when trigger throws Error with message', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(new Error('detailed-reason')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ reason: 'detailed-reason' }),
        }),
      );
    });

    test('should log error with sanitized name and message when trigger throws', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(new Error('specific-fail-message')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      // Kill 82:82 LogicalOperator mutant: errorMessage='specific-fail-message'
      // ?? '' → 'specific-fail-message', && '' → '' (empty string)
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('specific-fail-message'));
    });

    test('should log empty string for undefined error message when non-object thrown', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(42),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      // When errorMessage is undefined, we use '' in the log
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining(''));
    });

    test('should return 200 with empty object on success', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockResolvedValue(undefined),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    test('should include exact error message when body is not array', async () => {
      // Kill 58:33 StringLiteral mutant
      req.params = { type: 'docker', name: 'update' };
      req.body = 'not-array';
      await triggerApi.runTriggerBatch(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Body must be an array of containers' }),
      );
    });

    test('should include trigger name in 404 error message', async () => {
      // Kill 66:33 StringLiteral mutant `` template literal
      req.params = { type: 'docker', name: 'notfound' };
      req.body = [{ id: 'c1' }];
      registry.getState.mockReturnValue({ trigger: {} });
      await triggerApi.runTriggerBatch(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Trigger notfound not found' }),
      );
    });

    test('should not modify container when agent field is absent', async () => {
      // Kill 72:11 ConditionalExpression true mutant
      req.params = { type: 'docker', name: 'update' };
      const containerWithoutAgent = { id: 'c1', name: 'nginx' };
      req.body = [containerWithoutAgent];
      const mockTrigger = { triggerBatch: vi.fn().mockResolvedValue(undefined) };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });
      await triggerApi.runTriggerBatch(req, res);
      // Container should be passed without extra modification; no operationIds so runtimeContext is undefined
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'c1', name: 'nginx' })],
        undefined,
      );
    });

    test('should log empty string when errorMessage is undefined (not Stryker was here)', async () => {
      // Kill 82:98 StringLiteral "Stryker was here!" and 82:82 LogicalOperator mutants
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(42), // non-object, no message
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      // errorMessage is undefined → ?? '' → log contains ''
      // If mutant applies: ?? "Stryker was here!" → log contains 'Stryker was here!'
      // If && mutant: undefined && '' = undefined → log contains 'undefined' string
      const logCall = mockLogError.mock.calls[0][0];
      expect(logCall).not.toContain('Stryker was here!');
      expect(logCall).not.toContain('undefined');
      // Should end with ':' + ' ' + '' (empty)
      expect(logCall).toMatch(/update:?\s*$/u);
    });

    test('should include reason in error details when Error thrown', async () => {
      // Kill 87:18 ObjectLiteral {} mutant
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(new Error('specific-reason')),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.details).toBeDefined();
      expect(jsonCall.details.reason).toBe('specific-reason');
    });

    test('triggerId is constructed from type.name (lowercased is not forced here)', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      registry.getState.mockReturnValue({ trigger: {} });

      await triggerApi.runTriggerBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Trigger update not found' }),
      );
    });
  });

  describe('getErrorMessage', () => {
    test('should return undefined when trigger throws non-object error (no error message path)', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue(null),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      // null has no message, so getErrorMessage returns undefined → default 500
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal Server Error' }),
      );
    });

    test('should return undefined when thrown object has non-string message', async () => {
      req.params = { type: 'docker', name: 'update' };
      req.body = [{ id: 'c1' }];
      const mockTrigger = {
        triggerBatch: vi.fn().mockRejectedValue({ message: 42 }),
      };
      registry.getState.mockReturnValue({
        trigger: { 'docker.update': mockTrigger },
      });

      await triggerApi.runTriggerBatch(req, res);

      // { message: 42 } – message is not a string, getErrorMessage returns undefined
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal Server Error' }),
      );
    });
  });
});
