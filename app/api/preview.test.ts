import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainer: vi.fn(),
}));

vi.mock('../registry', () => ({
  getState: vi.fn(() => ({
    trigger: {},
  })),
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as previewRouter from './preview.js';

function createResponse() {
  return createMockResponse();
}

function getHandler(method, path) {
  previewRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

async function callPreview(id = 'c1') {
  const handler = getHandler('post', '/:id/preview');
  const res = createResponse();
  await handler({ params: { id } }, res);
  return res;
}

describe('Preview Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('should register routes', () => {
      previewRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/preview', expect.any(Function));
    });
  });

  describe('previewContainer', () => {
    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      const res = await callPreview('missing');
      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 404 when no docker trigger found', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ trigger: {} });
      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No docker trigger found') }),
      );
    });

    test('should return 404 when triggers exist but none are docker type', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'slack.default': { type: 'slack' } },
      });
      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should return preview result on success', async () => {
      const previewResult = {
        containerName: 'my-app',
        currentImage: 'hub/library/nginx:1.24',
        newImage: 'hub/library/nginx:1.25',
        updateKind: { kind: 'tag', localValue: '1.24', remoteValue: '1.25' },
        isRunning: true,
        networks: ['bridge'],
      };
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockResolvedValue(previewResult),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(mockTrigger.preview).toHaveBeenCalledWith({ id: 'c1', watcher: 'local' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(previewResult);
    });

    test('should return 500 when preview throws', async () => {
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue(new Error('Docker API error')),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Docker API error') }),
      );
    });

    test('should stringify non-Error preview failures', async () => {
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue('preview failed as string'),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('preview failed as string') }),
      );
    });

    test('should skip docker triggers with mismatched agent', async () => {
      const mockTrigger = {
        type: 'docker',
        agent: 'agent-2',
        preview: vi.fn(),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local', agent: 'agent-1' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockTrigger.preview).not.toHaveBeenCalled();
    });

    test('should skip local docker triggers for agent containers', async () => {
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn(),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local', agent: 'remote' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockTrigger.preview).not.toHaveBeenCalled();
    });

    test('should match docker trigger with same agent', async () => {
      const previewResult = { containerName: 'my-app' };
      const mockTrigger = {
        type: 'docker',
        agent: 'remote',
        preview: vi.fn().mockResolvedValue(previewResult),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local', agent: 'remote' });
      registry.getState.mockReturnValue({
        trigger: { 'remote.docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(previewResult);
    });
  });
});
