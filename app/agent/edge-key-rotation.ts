import { createHash } from 'node:crypto';
import * as keys from '../store/agent-keys.js';

interface EdgeRotationStatus {
  current_key_id: string;
  pending_key_id?: string;
  pending_public_key?: string;
  activation_pending?: boolean;
}

export interface EdgeRotationPublicStatus {
  enabled: true;
  current_key_id: string;
  pending_key_id?: string;
  phase: 'idle' | 'pending' | 'awaiting-reconnect' | 'aborted';
}

type RotationRpc = (method: string, target: string, body: unknown) => Promise<unknown>;
const edgeRotationPath = '/_portwing/auth/rotation/edge';

function responseBody(value: unknown): EdgeRotationStatus {
  const response = value as { statusCode?: number; body?: unknown; bodyBase64?: string } | null;
  if (
    !response ||
    typeof response.statusCode !== 'number' ||
    response.statusCode < 200 ||
    response.statusCode >= 300
  ) {
    throw new Error('Agent key rotation request failed');
  }
  const body =
    response.bodyBase64 === undefined
      ? response.body
      : JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.current_key_id !== 'string'
  ) {
    throw new Error('Invalid agent key rotation response');
  }
  return body as EdgeRotationStatus;
}

export class EdgeKeyRotationController {
  private inFlight?: Promise<EdgeRotationPublicStatus>;
  private inFlightAction?: 'rotate' | 'abort';
  constructor(
    private readonly agentName: string,
    private readonly currentKeyId: string,
    private readonly request: RotationRpc,
    private readonly reconnect: () => void,
  ) {}

  status(): EdgeRotationPublicStatus {
    const pending = keys.getPendingRotation(this.currentKeyId, this.agentName);
    return {
      enabled: true,
      current_key_id: this.currentKeyId,
      ...(pending ? { pending_key_id: pending.keyId } : {}),
      phase: pending ? 'pending' : 'idle',
    };
  }

  rotate(action: 'rotate' | 'abort'): Promise<EdgeRotationPublicStatus> {
    if (this.inFlight) {
      return action === this.inFlightAction
        ? this.inFlight
        : Promise.reject(new Error('A different key rotation operation is already running'));
    }
    this.inFlightAction = action;
    this.inFlight = this.perform(action).finally(() => {
      this.inFlight = undefined;
      this.inFlightAction = undefined;
    });
    return this.inFlight;
  }

  private async perform(action: 'rotate' | 'abort'): Promise<EdgeRotationPublicStatus> {
    keys.assertExclusiveRotationOwner(this.currentKeyId, this.agentName);
    if (action === 'abort') {
      const status = responseBody(await this.request('POST', `${edgeRotationPath}/abort`, {}));
      if (status.current_key_id !== this.currentKeyId || status.pending_key_id) {
        throw new Error('Agent did not acknowledge key rotation cancellation');
      }
      keys.cancelRotationKey(this.currentKeyId, this.agentName);
      return { ...this.status(), phase: 'aborted' };
    }
    const prepared = responseBody(await this.request('POST', `${edgeRotationPath}/prepare`, {}));
    if (
      prepared.current_key_id !== this.currentKeyId ||
      typeof prepared.pending_public_key !== 'string'
    ) {
      throw new Error('Agent replacement identity did not match the current connection');
    }
    const pub = Buffer.from(prepared.pending_public_key, 'base64');
    const id = createHash('sha256').update(pub).digest('hex').slice(0, 16);
    if (
      pub.length !== 32 ||
      pub.toString('base64') !== prepared.pending_public_key ||
      id !== prepared.pending_key_id
    ) {
      throw new Error('Agent replacement key ID does not match its public key');
    }
    const next = keys.addRotationKey(this.currentKeyId, this.agentName, pub);
    const activated = responseBody(
      await this.request('POST', `${edgeRotationPath}/activate`, { key_id: next.keyId }),
    );
    if (
      activated.current_key_id !== this.currentKeyId ||
      activated.pending_key_id !== next.keyId ||
      activated.activation_pending !== true
    ) {
      throw new Error('Agent did not acknowledge replacement activation');
    }
    const result = { ...this.status(), phase: 'awaiting-reconnect' as const };
    this.reconnect();
    return result;
  }
}
