import { beforeEach, describe, expect, test } from 'vitest';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import * as watcherApi from './watcher.js';

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

vi.mock('../../api/component.js', () => ({
  mapComponentsToList: vi.fn().mockReturnValue([]),
  mapComponentToItem: vi.fn().mockImplementation((key, component) => ({
    id: key,
    type: component.type,
    name: component.name,
    configuration: component.configuration ?? {},
    metadata: component.metadata,
  })),
}));

vi.mock('../../store/container.js', () => ({
  getContainer: vi.fn(),
}));

describe('agent API watcher', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {} };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
  });

  describe('getWatchers', () => {
    test('should return list of watchers', () => {
      const watchers = { 'docker.local': {} };
      registry.getState.mockReturnValue({ watcher: watchers });
      watcherApi.getWatchers(req, res);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('watchWatcher', () => {
    test('should return 404 when watcher is not found', async () => {
      req.params = { type: 'docker', name: 'local' };
      registry.getState.mockReturnValue({ watcher: {} });
      await watcherApi.watchWatcher(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should call watcher.watch and return results', async () => {
      req.params = { type: 'Docker', name: 'Local' };
      const mockWatcher = {
        watch: vi.fn().mockResolvedValue([{ container: { id: 'c1' } }]),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      await watcherApi.watchWatcher(req, res);
      expect(mockWatcher.watch).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith('X-Drydock-Watch-Coalesced', 'false');
      expect(res.json).toHaveBeenCalledWith([{ container: { id: 'c1' } }]);
    });

    // DR-60: the controller polls this endpoint the same way the cron schedule does, so
    // a poll landing while a scan is already in flight is routed through watchFromCron()
    // and coalesced into that scan's follow-up rather than running a second, independent
    // scan. The response body stays a bare ContainerReport[] (AgentClient.watch()'s wire
    // contract); coalescing is surfaced as a header instead.
    test('routes a cron-capable watcher through watchFromCron and reports coalesced via header', async () => {
      req.params = { type: 'docker', name: 'local' };
      const reports = [{ container: { id: 'c1' } }];
      const watchFromCron = vi.fn().mockResolvedValue(reports);
      const mockWatcher = {
        watch: vi.fn(),
        watchFromCron,
        cronWatchInFlight: Promise.resolve(reports),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      await watcherApi.watchWatcher(req, res);
      expect(mockWatcher.watch).not.toHaveBeenCalled();
      expect(watchFromCron).toHaveBeenCalledWith({
        ignoreMaintenanceWindow: true,
        reason: 'agent-poll',
      });
      expect(res.set).toHaveBeenCalledWith('X-Drydock-Watch-Coalesced', 'true');
      expect(res.json).toHaveBeenCalledWith(reports);
    });

    test('should return 500 when watcher throws', async () => {
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue(new Error('watch failed')),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      await watcherApi.watchWatcher(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should return the sanitized message for non-Error rejections, not the raw content', async () => {
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ message: 'watch failed as plain object' }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should never leak sensitive content from a non-Error rejection into the response', async () => {
      req.params = { type: 'docker', name: 'local' };
      const secret = 'Authorization: Bearer sk-secret-abc123';
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ message: secret, headers: { authorization: secret } }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      const serializedResponse = JSON.stringify(res.json.mock.calls);
      expect(serializedResponse).not.toContain(secret);
      expect(serializedResponse).not.toContain('sk-secret-abc123');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });
  });

  describe('getWatcher', () => {
    test('should return a specific watcher', () => {
      req.params = { type: 'docker', name: 'local' };
      registry.getState.mockReturnValue({
        watcher: {
          'docker.local': {
            type: 'docker',
            name: 'local',
            configuration: { cron: '0 * * * *' },
            metadata: { nextRunAt: '2026-04-09T13:00:00.000Z' },
          },
        },
      });

      watcherApi.getWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        id: 'docker.local',
        type: 'docker',
        name: 'local',
        configuration: { cron: '0 * * * *' },
        metadata: { nextRunAt: '2026-04-09T13:00:00.000Z' },
      });
    });

    test('should return 404 when the watcher detail is missing', () => {
      req.params = { type: 'docker', name: 'missing' };
      registry.getState.mockReturnValue({ watcher: {} });

      watcherApi.getWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Watcher missing not found' }),
      );
    });
  });

  describe('watchContainer', () => {
    test('should return 404 when watcher is not found', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      registry.getState.mockReturnValue({ watcher: {} });
      await watcherApi.watchContainer(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should return 404 when container is not found', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      const mockWatcher = {};
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(undefined);
      await watcherApi.watchContainer(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('c1') }),
      );
    });

    test('should call watcher.watchContainer and return result', async () => {
      req.params = { type: 'Docker', name: 'Local', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockResolvedValue({ container }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);
      await watcherApi.watchContainer(req, res);
      expect(mockWatcher.watchContainer).toHaveBeenCalledWith(container);
      expect(res.json).toHaveBeenCalledWith({ container });
    });

    test('should return 500 when watchContainer throws', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue(new Error('watch failed')),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);
      await watcherApi.watchContainer(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should return the sanitized message for non-object rejections when watchContainer throws', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue(42),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);

      await watcherApi.watchContainer(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should never leak sensitive content from a non-Error rejection into the watchContainer response', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const secret = 'Authorization: Bearer sk-secret-abc123';
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue({ message: secret }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);

      await watcherApi.watchContainer(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      const serializedResponse = JSON.stringify(res.json.mock.calls);
      expect(serializedResponse).not.toContain(secret);
      expect(serializedResponse).not.toContain('sk-secret-abc123');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });
  });

  describe('hasStringMessage', () => {
    test('should return INTERNAL_SERVER_ERROR for Error instances in watchWatcher', async () => {
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue(new Error('original message')),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      // Error instances should use INTERNAL_SERVER_ERROR_MESSAGE
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should log the message from a plain object with a string message but respond with the sanitized message', async () => {
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ message: 'plain-object-msg' }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('plain-object-msg'));
    });

    test('should log a stringified non-object, non-Error value but respond with the sanitized message', async () => {
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue('string-error'),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('string-error'));
    });

    test('should use INTERNAL_SERVER_ERROR for Error instances in watchContainer', async () => {
      req.params = { type: 'docker', name: 'local', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue(new Error('real error msg')),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);

      await watcherApi.watchContainer(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('should return internal server error when thrown value is null', async () => {
      // null: typeof null === 'object' && value === null → hasStringMessage returns false
      // normalizeErrorMessage falls to String(null) = "null"
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue(null),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      // null is not an Error; the client still only ever sees the sanitized message
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('null'));
    });

    test('should log the stringified value for a non-string message object (message=number) but respond with the sanitized message', async () => {
      // { message: 123 } → hasStringMessage returns false → String({ message: 123 })
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ message: 123 }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      // hasStringMessage({ message: 123 }) → false → String({ message: 123 }) = '[object Object]'
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('[object Object]'));
    });

    test('should return internal server error for object without message key', async () => {
      // { code: 404 } → 'message' not in value → hasStringMessage returns false
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ code: 404 }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
    });

    test('normalizeErrorMessage should use Error.message not String(error)', async () => {
      // Error instances: normalizeErrorMessage returns error.message directly
      // If BlockStatement mutant applies, it falls through to hasStringMessage
      // hasStringMessage(error) where error is Error instance:
      //   typeof error === 'object' && error !== null && 'message' in error → true
      //   typeof error.message === 'string' → true → returns error.message
      // So both paths return the message — but the 500 response uses INTERNAL_SERVER_ERROR
      // regardless. The block statement mutant matters because it would return 'original msg'
      // instead of 'Internal server error'. Let's verify the 500 uses INTERNAL_SERVER_ERROR.
      req.params = { type: 'docker', name: 'local' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue(new Error('specific-error-message')),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' }),
      );
      // The message should be logged, not returned to caller
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('specific-error-message'));
    });
  });

  describe('log error messages', () => {
    test('watchWatcher should log the watcher name and message in error log', async () => {
      req.params = { type: 'docker', name: 'mywatcher' };
      const mockWatcher = {
        watch: vi.fn().mockRejectedValue({ message: 'watch-fail-msg' }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.mywatcher': mockWatcher },
      });

      await watcherApi.watchWatcher(req, res);

      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('mywatcher'));
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('watch-fail-msg'));
    });

    test('watchContainer should log the container id and message in error log', async () => {
      req.params = { type: 'docker', name: 'local', id: 'container-xyz' };
      const container = { id: 'container-xyz', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockRejectedValue({ message: 'container-fail-msg' }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);

      await watcherApi.watchContainer(req, res);

      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('container-xyz'));
      expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('container-fail-msg'));
    });
  });

  describe('watcherId construction', () => {
    test('watchWatcher should build watcherId from lowercased type and name', async () => {
      req.params = { type: 'DOCKER', name: 'LOCAL' };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': { watch: vi.fn().mockResolvedValue([]) } },
      });

      await watcherApi.watchWatcher(req, res);

      expect(res.json).toHaveBeenCalledWith([]);
    });

    test('watchContainer should build watcherId from lowercased type and name', async () => {
      req.params = { type: 'DOCKER', name: 'LOCAL', id: 'c1' };
      const container = { id: 'c1', name: 'test' };
      const mockWatcher = {
        watchContainer: vi.fn().mockResolvedValue({ result: 'ok' }),
      };
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(container);

      await watcherApi.watchContainer(req, res);

      expect(res.json).toHaveBeenCalledWith({ result: 'ok' });
    });

    test('getWatcher should build watcherId from lowercased type and name', () => {
      req.params = { type: 'DOCKER', name: 'LOCAL' };
      registry.getState.mockReturnValue({
        watcher: {
          'docker.local': {
            type: 'docker',
            name: 'local',
            configuration: {},
            metadata: {},
          },
        },
      });

      watcherApi.getWatcher(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'docker.local' }));
    });
  });

  describe('watcher error messages', () => {
    test('watchWatcher 404 error message should include watcher name', async () => {
      req.params = { type: 'docker', name: 'missing-watcher' };
      registry.getState.mockReturnValue({ watcher: {} });

      await watcherApi.watchWatcher(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Watcher missing-watcher not found' }),
      );
    });

    test('watchContainer 404 error message should include watcher name when watcher missing', async () => {
      req.params = { type: 'docker', name: 'no-watcher', id: 'c1' };
      registry.getState.mockReturnValue({ watcher: {} });

      await watcherApi.watchContainer(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Watcher no-watcher not found' }),
      );
    });

    test('watchContainer 404 should include container id in error message', async () => {
      req.params = { type: 'docker', name: 'local', id: 'my-container-id' };
      const mockWatcher = {};
      registry.getState.mockReturnValue({
        watcher: { 'docker.local': mockWatcher },
      });
      storeContainer.getContainer.mockReturnValue(undefined);

      await watcherApi.watchContainer(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('my-container-id') }),
      );
    });
  });
});
