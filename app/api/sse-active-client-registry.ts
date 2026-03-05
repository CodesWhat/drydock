import type { Response } from 'express';

export interface FlushableResponse extends Response {
  flush?: () => void;
}

export interface ActiveSseClient {
  clientId: string;
  clientToken: string;
  clientTokenHash: Buffer;
  clientTokenHashHex: string;
  response: FlushableResponse;
  connectedAtMs: number;
}

export class ActiveSseClientRegistry {
  private readonly byToken = new Map<string, ActiveSseClient>();
  private readonly byTokenHash = new Map<string, ActiveSseClient>();
  private readonly byResponse = new Map<FlushableResponse, ActiveSseClient>();

  add(client: ActiveSseClient): void {
    this.byResponse.set(client.response, client);
    this.byToken.set(client.clientToken, client);
    this.byTokenHash.set(client.clientTokenHashHex, client);
  }

  remove(client: ActiveSseClient): void {
    if (this.byToken.get(client.clientToken) === client) {
      this.byToken.delete(client.clientToken);
    }
    if (this.byTokenHash.get(client.clientTokenHashHex) === client) {
      this.byTokenHash.delete(client.clientTokenHashHex);
    }
    if (this.byResponse.get(client.response) === client) {
      this.byResponse.delete(client.response);
    }
  }

  clear(): void {
    this.byToken.clear();
    this.byTokenHash.clear();
    this.byResponse.clear();
  }

  hasByResponse(response: FlushableResponse): boolean {
    return this.byResponse.has(response);
  }

  getByResponse(response: FlushableResponse): ActiveSseClient | undefined {
    return this.byResponse.get(response);
  }

  getByTokenHashHex(tokenHashHex: string): ActiveSseClient | undefined {
    return this.byTokenHash.get(tokenHashHex);
  }

  listClientTokens(): Set<string> {
    return new Set(this.byToken.keys());
  }

  sizeByToken(): number {
    return this.byToken.size;
  }

  sizeByTokenHash(): number {
    return this.byTokenHash.size;
  }

  sizeByResponse(): number {
    return this.byResponse.size;
  }

  // Test helper used to validate stale-sweep behavior when indexes drift.
  simulateTokenHashOnlyDrift(response: FlushableResponse): void {
    const client = this.byResponse.get(response);
    if (!client) {
      return;
    }
    if (this.byToken.get(client.clientToken) === client) {
      this.byToken.delete(client.clientToken);
    }
    this.byResponse.delete(response);
  }

  hasConsistentReferences(client: ActiveSseClient): boolean {
    return (
      this.byResponse.get(client.response) === client &&
      this.byToken.get(client.clientToken) === client &&
      this.byTokenHash.get(client.clientTokenHashHex) === client
    );
  }

  listClients(): IterableIterator<ActiveSseClient> {
    return this.byResponse.values();
  }
}

export interface ActiveSseClientRegistryTestAdapter {
  clear(): void;
  hasByResponse(response: FlushableResponse): boolean;
  getByResponse(response: FlushableResponse): ActiveSseClient | undefined;
  sizeByToken(): number;
  sizeByTokenHash(): number;
  sizeByResponse(): number;
  simulateTokenHashOnlyDrift(response: FlushableResponse): void;
}

// Invariant: each ActiveSseClient is either absent from all indexes or present
// in all three maps with the same object reference.
export function createActiveSseClientRegistryTestAdapter(
  registry: ActiveSseClientRegistry,
): ActiveSseClientRegistryTestAdapter {
  return {
    clear(): void {
      registry.clear();
    },
    hasByResponse(response: FlushableResponse): boolean {
      return registry.hasByResponse(response);
    },
    getByResponse(response: FlushableResponse): ActiveSseClient | undefined {
      return registry.getByResponse(response);
    },
    sizeByToken(): number {
      return registry.sizeByToken();
    },
    sizeByTokenHash(): number {
      return registry.sizeByTokenHash();
    },
    sizeByResponse(): number {
      return registry.sizeByResponse();
    },
    simulateTokenHashOnlyDrift(response: FlushableResponse): void {
      registry.simulateTokenHashOnlyDrift(response);
    },
  };
}
