import { beforeEach, describe, expect, test } from 'vitest';
import { mapComponentsToList } from '../../api/component.js';
import * as apiTrigger from '../../api/trigger.js';
import * as registry from '../../registry/index.js';
import * as triggerApi from './trigger.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
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
      expect(mockTrigger.triggerBatch).toHaveBeenCalledWith([{ id: 'c1' }, { id: 'c2' }]);
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
  });
});
