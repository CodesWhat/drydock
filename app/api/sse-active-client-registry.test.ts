import { createHash } from 'node:crypto';
import {
  type ActiveSseClient,
  ActiveSseClientRegistry,
  createActiveSseClientRegistryTestAdapter,
  type FlushableResponse,
} from './sse-active-client-registry.js';

function createResponse(): FlushableResponse {
  return {
    write: vi.fn(),
    flush: vi.fn(),
    on: vi.fn(),
  } as unknown as FlushableResponse;
}

function createClient(
  response: FlushableResponse,
  token: string,
  clientId = 'client-1',
): ActiveSseClient {
  const tokenHash = createHash('sha256').update(token, 'utf8').digest();
  return {
    clientId,
    clientToken: token,
    clientTokenHash: tokenHash,
    clientTokenHashHex: tokenHash.toString('hex'),
    response,
    connectedAtMs: Date.now(),
  };
}

describe('ActiveSseClientRegistry', () => {
  test('tracks add/remove across all indexes', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();
    const client = createClient(response, 'token-1');

    registry.add(client);

    expect(registry.getByResponse(response)).toBe(client);
    expect(registry.getByTokenHashHex(client.clientTokenHashHex)).toBe(client);
    expect(registry.hasByResponse(response)).toBe(true);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);

    registry.remove(client);

    expect(registry.getByResponse(response)).toBeUndefined();
    expect(registry.getByTokenHashHex(client.clientTokenHashHex)).toBeUndefined();
    expect(registry.hasByResponse(response)).toBe(false);
    expect(registry.sizeByToken()).toBe(0);
    expect(registry.sizeByTokenHash()).toBe(0);
    expect(registry.sizeByResponse()).toBe(0);
  });

  test('does not remove entries for stale client references', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();
    const client = createClient(response, 'token-1', 'client-1');
    registry.add(client);

    const staleClientReference: ActiveSseClient = {
      ...client,
    };

    registry.remove(staleClientReference);

    expect(registry.getByResponse(response)).toBe(client);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);
  });

  test('clears all indexes', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();
    const client = createClient(response, 'token-1');
    registry.add(client);

    registry.clear();

    expect(registry.sizeByToken()).toBe(0);
    expect(registry.sizeByTokenHash()).toBe(0);
    expect(registry.sizeByResponse()).toBe(0);
  });

  test('returns a defensive copy of client tokens', () => {
    const registry = new ActiveSseClientRegistry();
    const client = createClient(createResponse(), 'token-1');
    registry.add(client);

    const listedTokens = registry.listClientTokens();
    listedTokens.clear();

    expect(registry.sizeByToken()).toBe(1);
    expect(registry.listClientTokens()).toEqual(new Set([client.clientToken]));
  });

  test('reports consistent references and detects token/hash drift after token collisions', () => {
    const registry = new ActiveSseClientRegistry();
    const firstClient = createClient(createResponse(), 'shared-token', 'client-1');
    const secondClient = createClient(createResponse(), 'shared-token', 'client-2');

    registry.add(firstClient);
    registry.add(secondClient);

    expect(registry.hasConsistentReferences(firstClient)).toBe(false);
    expect(registry.hasConsistentReferences(secondClient)).toBe(true);
  });

  test('drift helper is a no-op for unknown responses', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();

    expect(() => registry.simulateTokenHashOnlyDrift(response)).not.toThrow();
    expect(registry.sizeByToken()).toBe(0);
    expect(registry.sizeByTokenHash()).toBe(0);
    expect(registry.sizeByResponse()).toBe(0);
  });

  test('drift helper tolerates token index reassignment', () => {
    const registry = new ActiveSseClientRegistry();
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    const firstClient = createClient(firstResponse, 'shared-token', 'client-1');
    const secondClient = createClient(secondResponse, 'shared-token', 'client-2');
    registry.add(firstClient);
    registry.add(secondClient);

    registry.simulateTokenHashOnlyDrift(firstResponse);

    expect(registry.getByResponse(firstResponse)).toBeUndefined();
    expect(registry.getByResponse(secondResponse)).toBe(secondClient);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);
  });

  test('test adapter delegates operations to the registry', () => {
    const registry = new ActiveSseClientRegistry();
    const adapter = createActiveSseClientRegistryTestAdapter(registry);
    const response = createResponse();
    const client = createClient(response, 'token-1');
    registry.add(client);

    expect(adapter.hasByResponse(response)).toBe(true);
    expect(adapter.getByResponse(response)).toBe(client);
    expect(adapter.sizeByToken()).toBe(1);
    expect(adapter.sizeByTokenHash()).toBe(1);
    expect(adapter.sizeByResponse()).toBe(1);

    adapter.simulateTokenHashOnlyDrift(response);
    expect(adapter.getByResponse(response)).toBeUndefined();

    adapter.clear();
    expect(adapter.sizeByToken()).toBe(0);
    expect(adapter.sizeByTokenHash()).toBe(0);
    expect(adapter.sizeByResponse()).toBe(0);
  });
});
