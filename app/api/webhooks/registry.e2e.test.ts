import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import * as configuration from '../../configuration/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import {
  _resetRegistryWebhookFreshStateForTests,
  consumeFreshContainerScheduledPollSkip,
} from '../../watchers/registry-webhook-fresh.js';
import * as registryWebhookRouter from './registry.js';

function signPayload(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('api/webhooks/registry E2E', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetRegistryWebhookFreshStateForTests();
  });

  test('accepts a signed Docker Hub webhook and marks the matching container fresh', async () => {
    const secret = 'webhook-secret';
    const payload = JSON.stringify({
      repository: { repo_name: 'library/nginx' },
      push_data: { tag: 'latest' },
    });

    vi.spyOn(configuration, 'getWebhookConfiguration').mockReturnValue({
      enabled: true,
      secret,
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });

    const watchContainer = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(storeContainer, 'getContainers').mockReturnValue([
      {
        id: 'container-1',
        watcher: 'local',
        image: {
          name: 'library/nginx',
          registry: { url: 'https://registry-1.docker.io' },
        },
      } as any,
    ]);
    vi.spyOn(registry, 'getState').mockReturnValue({
      watcher: {
        'docker.local': {
          watchContainer,
        },
      },
    } as any);

    const app = express();
    app.use(
      express.json({
        limit: '256kb',
        verify: (req, _res, buffer) => {
          (req as { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
        },
      }),
    );
    app.use('/api/webhooks/registry', registryWebhookRouter.init());

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const startedServer = app.listen(0, () => resolve(startedServer));
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/webhooks/registry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signPayload(payload, secret),
        },
        body: payload,
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        message: 'Registry webhook processed',
        result: {
          provider: 'dockerhub',
          referencesMatched: 1,
          containersMatched: 1,
          checksTriggered: 1,
          checksFailed: 0,
          watchersMissing: 0,
        },
      });
      expect(watchContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'container-1',
        }),
      );
      expect(consumeFreshContainerScheduledPollSkip('container-1')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
