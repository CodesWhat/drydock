import { beforeEach, describe, expect, test } from 'vitest';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import * as watcherApi from './watcher.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../registry/index.js', () => ({
  getState: vi.fn(),
}));

vi.mock('../../api/component.js', () => ({
  mapComponentsToList: vi.fn().mockReturnValue([]),
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
      expect(res.json).toHaveBeenCalledWith([{ container: { id: 'c1' } }]);
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'watch failed' }));
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'watch failed' }));
    });
  });
});
