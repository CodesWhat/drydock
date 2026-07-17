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
import * as previewErrors from './preview-errors.js';

function getHandler(method, path) {
  previewRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

async function callPreview(id = 'c1') {
  const handler = getHandler('post', '/:id/preview');
  const res = createMockResponse();
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
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        code: 'container-not-found',
        message: 'Container not found',
      });
    });

    test('should return 404 when no docker trigger found', async () => {
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({ trigger: {} });
      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        code: 'no-trigger-configured',
        message: 'No action trigger configured for this container',
        action: {
          label: 'Open trigger settings',
          href: '/triggers',
        },
      });
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

    test('should return an actionable registry authentication error when preview receives 401', async () => {
      const authenticationError = Object.assign(new Error('request failed: 401 Unauthorized'), {
        response: { status: 401 },
      });
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue(authenticationError),
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        watcher: 'local',
        image: { registry: { url: 'ghcr.io' } },
      });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'registry-auth-failed',
        message: 'Authentication failed for ghcr.io: 401 Unauthorized',
        details: { reason: 'request failed: 401 Unauthorized', registry: 'ghcr.io' },
        action: {
          label: 'Open registry settings',
          href: '/registries',
        },
      });
    });

    test('should return an actionable registry configuration error', async () => {
      const configurationError = Object.assign(
        new Error('Unsupported registry manager "ghcr". Configure a matching registry.'),
        { code: 'registry-manager-unsupported' },
      );
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue(configurationError),
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        watcher: 'local',
        image: { name: 'private/image', registry: { url: 'ghcr.io' } },
      });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        code: 'registry-not-found',
        message: 'No matching registry configured for ghcr.io/private/image',
        details: {
          reason: 'Unsupported registry manager "ghcr". Configure a matching registry.',
          registry: 'ghcr.io',
        },
        action: {
          label: 'Open registry settings',
          href: '/registries',
        },
      });
    });

    test('should return an actionable network error without reflecting credentials', async () => {
      const networkError = Object.assign(
        new Error('connect ECONNREFUSED https://user:secret@registry.example/v2/'),
        { code: 'ECONNREFUSED' },
      );
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue(networkError),
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        watcher: 'local',
        image: { registry: { url: 'registry.example' } },
      });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        code: 'registry-network-error',
        message: 'Unable to reach registry.example while preparing the update preview',
        details: {
          reason: 'connect ECONNREFUSED https://[REDACTED]@registry.example/v2/',
          registry: 'registry.example',
        },
        action: {
          label: 'Open registry settings',
          href: '/registries',
        },
      });
    });

    test('should type unknown preview failures instead of returning a generic error shape', async () => {
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
      expect(res.json).toHaveBeenCalledWith({
        code: 'preview-runtime-error',
        message: 'Unable to prepare this update preview',
      });
    });

    test('should use the typed message when an error has no diagnostic reason', async () => {
      const classifySpy = vi.spyOn(previewErrors, 'classifyPreviewError').mockReturnValueOnce({
        status: 500,
        payload: {
          code: 'preview-runtime-error',
          message: 'Unable to prepare this update preview',
        },
      });
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockRejectedValue(new Error('opaque preview failure')),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        code: 'preview-runtime-error',
        message: 'Unable to prepare this update preview',
      });
      classifySpy.mockRestore();
    });

    test('should turn trigger-level preview errors into typed API failures', async () => {
      const mockTrigger = {
        type: 'docker',
        preview: vi.fn().mockResolvedValue({ error: 'Container not found in Docker' }),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
      });

      const res = await callPreview();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        code: 'container-runtime-not-found',
        message: 'Container was not found by the configured Docker watcher',
      });
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

    test('should use compose trigger when no docker trigger exists', async () => {
      const previewResult = {
        containerName: 'my-app',
        currentImage: 'hub/library/nginx:1.24',
        newImage: 'hub/library/nginx:1.25',
        compose: {
          files: ['/stack/docker-compose.yml'],
          paths: ['/stack/docker-compose.yml'],
          service: 'web',
          mutation: {
            intent: 'update-compose-service-image',
            dryRun: true,
            willWrite: false,
          },
        },
      };
      const composeTrigger = {
        type: 'dockercompose',
        preview: vi.fn().mockResolvedValue(previewResult),
      };
      storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
      registry.getState.mockReturnValue({
        trigger: { 'dockercompose.default': composeTrigger },
      });

      const res = await callPreview();
      expect(composeTrigger.preview).toHaveBeenCalledWith({ id: 'c1', watcher: 'local' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(previewResult);
    });
  });
});
