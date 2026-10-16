import type { KeyObject } from 'node:crypto';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEd25519PrivateKey } from './ed25519-signer.js';

export interface RotationIdentity {
  keyId: string;
  privateKey: KeyObject;
  privatePem: string;
  publicKey: string;
}

export interface KeyRotationStatus {
  root_key_id: string;
  current_key_id: string;
  pending_key_id?: string;
}

export type RotationRequest = (
  identity: RotationIdentity,
  action: 'status' | 'prepare' | 'commit' | 'abort',
  body?: { public_key: string },
) => Promise<KeyRotationStatus>;

interface CredentialState {
  version: 1;
  rootKeyId: string;
  currentPem: string;
  pendingPem?: string;
}

function identityFromPem(privatePem: string): RotationIdentity {
  const privateKey = loadEd25519PrivateKey(privatePem);
  const raw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  return {
    keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    publicKey: raw.toString('base64'),
    privateKey,
    privatePem,
  };
}

function readPrivateState(file: string): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 65536) {
      throw new Error(
        'Managed signing credentials require a regular private file of at most 64 KiB',
      );
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function writePrivateState(file: string, serialized: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, serialized);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export class StandardKeyRotation {
  private readonly file: string;
  private readonly rootKeyId: string;
  private state: CredentialState;
  private serialized?: string;
  private active: RotationIdentity;
  private inFlight?: Promise<KeyRotationStatus>;

  constructor(
    directory: string,
    agentName: string,
    bootstrap: { keyId: string; privatePem: string },
  ) {
    const root = identityFromPem(bootstrap.privatePem);
    if (root.keyId !== bootstrap.keyId)
      throw new Error('Bootstrap signing key ID does not match its private key');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
      throw new Error('Managed signing credential directory requires mode 0700');
    }
    this.rootKeyId = root.keyId;
    const name = createHash('sha256').update(`${agentName}\n${root.keyId}`).digest('hex');
    this.file = path.join(directory, `${name}.json`);
    this.serialized = readPrivateState(this.file);
    this.state = { version: 1, rootKeyId: root.keyId, currentPem: bootstrap.privatePem };
    if (this.serialized !== undefined) {
      let value: CredentialState;
      try {
        value = JSON.parse(this.serialized) as CredentialState;
      } catch {
        throw new Error('Invalid managed signing credential state');
      }
      if (
        !value ||
        value.version !== 1 ||
        value.rootKeyId !== root.keyId ||
        typeof value.currentPem !== 'string' ||
        (value.pendingPem !== undefined && typeof value.pendingPem !== 'string')
      ) {
        throw new Error('Invalid managed signing credential state');
      }
      this.state = value;
    }
    this.active = identityFromPem(this.state.currentPem);
    if (
      this.state.pendingPem &&
      identityFromPem(this.state.pendingPem).keyId === this.active.keyId
    ) {
      throw new Error('Pending signing key must differ from the active key');
    }
  }

  get identity(): RotationIdentity {
    return this.active;
  }
  get hasPending(): boolean {
    return this.state.pendingPem !== undefined;
  }

  status(): KeyRotationStatus {
    return {
      root_key_id: this.rootKeyId,
      current_key_id: this.active.keyId,
      ...(this.state.pendingPem
        ? { pending_key_id: identityFromPem(this.state.pendingPem).keyId }
        : {}),
    };
  }

  rotate(request: RotationRequest): Promise<KeyRotationStatus> {
    return this.runOnce(() => this.performRotation(request));
  }

  abort(request: RotationRequest): Promise<KeyRotationStatus> {
    if (this.inFlight) return Promise.reject(new Error('A key rotation is already running'));
    return this.runOnce(async () => {
      const current = identityFromPem(this.state.currentPem);
      const result = await request(current, 'abort');
      this.requireStatus(result, current.keyId, undefined);
      this.persist({ ...this.state, pendingPem: undefined });
      return this.status();
    });
  }

  private runOnce(operation: () => Promise<KeyRotationStatus>): Promise<KeyRotationStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = operation().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async performRotation(request: RotationRequest): Promise<KeyRotationStatus> {
    if (!this.state.pendingPem) {
      const { privateKey } = generateKeyPairSync('ed25519');
      this.persist({
        ...this.state,
        pendingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      });
    }
    const current = identityFromPem(this.state.currentPem);
    const pending = identityFromPem(this.state.pendingPem as string);
    let result: KeyRotationStatus;
    try {
      result = await request(current, 'status');
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      result = await request(pending, 'status');
      this.requireStatus(result, pending.keyId, undefined);
      return this.promote(pending);
    }
    this.requireStatus(result, current.keyId, result.pending_key_id);
    if (result.pending_key_id && result.pending_key_id !== pending.keyId) {
      throw new Error('The agent has a different pending key; reconcile it before rotating');
    }
    result = await request(current, 'prepare', { public_key: pending.publicKey });
    this.requireStatus(result, current.keyId, pending.keyId);
    result = await request(pending, 'status');
    this.requireStatus(result, current.keyId, pending.keyId);
    result = await request(pending, 'commit');
    this.requireStatus(result, pending.keyId, undefined);
    return this.promote(pending);
  }

  private promote(pending: RotationIdentity): KeyRotationStatus {
    // The pending private key was durable before the remote change. Select it
    // even if final local persistence fails, so a committed agent stays usable.
    this.active = pending;
    this.persist({ version: 1, rootKeyId: this.rootKeyId, currentPem: pending.privatePem });
    return this.status();
  }

  private requireStatus(
    status: KeyRotationStatus,
    current: string,
    pending: string | undefined,
  ): void {
    if (
      !status ||
      status.root_key_id !== this.rootKeyId ||
      status.current_key_id !== current ||
      status.pending_key_id !== pending
    ) {
      throw new Error('Agent key rotation status did not match the expected keys');
    }
  }

  private persist(state: CredentialState): void {
    const serialized = JSON.stringify(state);
    const existing = readPrivateState(this.file);
    if (existing !== this.serialized && existing !== serialized) {
      throw new Error('Managed signing credentials changed; reconnect before retrying');
    }
    writePrivateState(this.file, serialized);
    this.serialized = serialized;
    this.state = state;
  }
}
