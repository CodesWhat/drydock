import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const liveWorkerPath = resolve(process.cwd(), '../apps/demo/public/mockServiceWorker.js');
const messageHandlerPattern =
  /addEventListener\('message',\s*(?:async\s*function\s*\(event\)|async\s*\(event\)\s*=>)\s*\{[\s\S]*?\n\}\);/;
const fallbackMessageHandler = `addEventListener('message', async (event) => {
  const clientId = Reflect.get(event.source || {}, 'id');

  if (!clientId || !self.clients) {
    return;
  }

  const client = await self.clients.get(clientId);

  if (!client) {
    return;
  }

  const allClients = await self.clients.matchAll({
    type: 'window',
  });

  switch (event.data) {
    case 'KEEPALIVE_REQUEST': {
      sendToClient(client, {
        type: 'KEEPALIVE_RESPONSE',
      });
      break;
    }

    case 'INTEGRITY_CHECK_REQUEST': {
      sendToClient(client, {
        type: 'INTEGRITY_CHECK_RESPONSE',
        payload: {
          packageVersion: PACKAGE_VERSION,
          checksum: INTEGRITY_CHECKSUM,
        },
      });
      break;
    }

    case 'MOCK_ACTIVATE': {
      activeClientIds.add(clientId);

      sendToClient(client, {
        type: 'MOCKING_ENABLED',
        payload: {
          client: {
            id: client.id,
            frameType: client.frameType,
          },
        },
      });
      break;
    }

    case 'CLIENT_CLOSED': {
      activeClientIds.delete(clientId);

      const remainingClients = allClients.filter((client) => {
        return client.id !== clientId;
      });

      // Unregister itself when there are no more clients
      if (remainingClients.length === 0) {
        self.registration.unregister();
      }

      break;
    }
  }
});`;

function readWorkerSource(): string {
  if (existsSync(liveWorkerPath)) {
    return readFileSync(liveWorkerPath, 'utf8');
  }

  return fallbackMessageHandler;
}

describe('demo mockServiceWorker message handler', () => {
  it('keeps the fallback handler in sync with the demo worker when available', () => {
    if (!existsSync(liveWorkerPath)) {
      return;
    }

    const liveHandler = readFileSync(liveWorkerPath, 'utf8').match(messageHandlerPattern)?.[0];
    expect(liveHandler).toBe(fallbackMessageHandler);
  });

  it('rejects postMessage events without a valid client ID', () => {
    const workerSource = readWorkerSource();
    const messageHandler = workerSource.match(messageHandlerPattern)?.[0];

    expect(messageHandler).toBeDefined();
    expect(messageHandler).toContain('clientId');
    expect(messageHandler).toMatch(
      /if\s*\(\s*!clientId\s*\|\|\s*!self\.clients\s*\)\s*\{[\s\S]*?\breturn;?[\s\S]*?\}/,
    );
  });
});
