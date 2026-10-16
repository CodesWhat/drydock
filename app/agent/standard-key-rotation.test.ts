import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type RotationIdentity,
  type RotationRequest,
  StandardKeyRotation,
} from './standard-key-rotation.js';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-key-rotation-'));
  directories.push(directory);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const bootstrap = {
    keyId: createHash('sha256').update(pub).digest('hex').slice(0, 16),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
  const create = () => new StandardKeyRotation(directory, 'remote/production', bootstrap);
  return { directory, bootstrap, create, originalPublic: pub };
}

function remote(f: ReturnType<typeof fixture>) {
  let current = f.bootstrap.keyId;
  let pending: string | undefined;
  const keys = new Map([[current, f.originalPublic]]);
  const calls: string[] = [];
  const request: RotationRequest = async (identity, action, body) => {
    const pub = keys.get(identity.keyId);
    if (!pub) throw Object.assign(new Error('unknown key'), { status: 401 });
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
      format: 'der',
      type: 'spki',
    });
    expect(
      verify(
        null,
        Buffer.from('possession'),
        publicKey,
        sign(null, Buffer.from('possession'), identity.privateKey),
      ),
    ).toBe(true);
    calls.push(`${action}:${identity.keyId}`);
    if (action === 'prepare') {
      expect(identity.keyId).toBe(current);
      const replacement = Buffer.from(body?.public_key ?? '', 'base64');
      expect(replacement).toHaveLength(32);
      expect(Object.keys(body ?? {})).toEqual(['public_key']);
      pending = createHash('sha256').update(replacement).digest('hex').slice(0, 16);
      keys.set(pending, replacement);
    } else if (action === 'commit') {
      expect(identity.keyId).toBe(pending);
      keys.delete(current);
      current = identity.keyId;
      pending = undefined;
    } else if (action === 'abort') {
      expect(identity.keyId).toBe(current);
      if (pending) keys.delete(pending);
      pending = undefined;
    }
    return {
      root_key_id: f.bootstrap.keyId,
      current_key_id: current,
      ...(pending ? { pending_key_id: pending } : {}),
    };
  };
  return { request, calls, keys };
}

describe('Standard controller key rotation', () => {
  test('persists the replacement before preparation and proves it before retiring the old key', async () => {
    const f = fixture();
    const manager = f.create();
    const peer = remote(f);
    const result = await manager.rotate(async (identity, action, body) => {
      if (action === 'prepare') {
        const restored = f.create();
        expect(restored.hasPending).toBe(true);
        expect(restored.identity.keyId).toBe(f.bootstrap.keyId);
      }
      return peer.request(identity, action, body);
    });
    expect(result.current_key_id).not.toBe(f.bootstrap.keyId);
    expect(manager.identity.keyId).toBe(result.current_key_id);
    expect(manager.hasPending).toBe(false);
    expect(peer.keys.has(f.bootstrap.keyId)).toBe(false);
    expect(peer.calls).toEqual([
      `status:${f.bootstrap.keyId}`,
      `prepare:${f.bootstrap.keyId}`,
      `status:${result.current_key_id}`,
      `commit:${result.current_key_id}`,
    ]);
    const restarted = f.create();
    expect(restarted.identity.keyId).toBe(result.current_key_id);
    expect(restarted.hasPending).toBe(false);
  });

  test('failed replacement proof leaves the original key usable and can be retried', async () => {
    const f = fixture();
    const manager = f.create();
    const peer = remote(f);
    await expect(
      manager.rotate(async (identity, action, body) => {
        if (identity.keyId !== f.bootstrap.keyId) throw new Error('proof unavailable');
        return peer.request(identity, action, body);
      }),
    ).rejects.toThrow('proof unavailable');
    expect(peer.keys.has(f.bootstrap.keyId)).toBe(true);
    expect(manager.identity.keyId).toBe(f.bootstrap.keyId);
    expect(manager.hasPending).toBe(true);
    const restarted = f.create();
    const result = await restarted.rotate(peer.request);
    expect(result.current_key_id).not.toBe(f.bootstrap.keyId);
    expect(peer.keys.has(f.bootstrap.keyId)).toBe(false);
  });

  test('recovers after a committed response is lost without generating another key', async () => {
    const f = fixture();
    const manager = f.create();
    const peer = remote(f);
    let committed: RotationIdentity | undefined;
    await expect(
      manager.rotate(async (identity, action, body) => {
        const result = await peer.request(identity, action, body);
        if (action === 'commit') {
          committed = identity;
          throw new Error('connection lost');
        }
        return result;
      }),
    ).rejects.toThrow('connection lost');
    expect(manager.hasPending).toBe(true);
    expect(peer.keys.has(f.bootstrap.keyId)).toBe(false);
    const restarted = f.create();
    const result = await restarted.rotate(peer.request);
    expect(result.current_key_id).toBe(committed?.keyId);
    expect(restarted.identity.keyId).toBe(committed?.keyId);
    expect(restarted.hasPending).toBe(false);
  });

  test('abort uses the original key and clears only the uncommitted replacement', async () => {
    const f = fixture();
    const manager = f.create();
    const peer = remote(f);
    await expect(
      manager.rotate(async (identity, action, body) => {
        if (action === 'commit') throw new Error('not confirmed');
        return peer.request(identity, action, body);
      }),
    ).rejects.toThrow('not confirmed');
    const result = await manager.abort(peer.request);
    expect(result.current_key_id).toBe(f.bootstrap.keyId);
    expect(manager.hasPending).toBe(false);
    expect(peer.keys.size).toBe(1);
    expect(peer.keys.has(f.bootstrap.keyId)).toBe(true);
    expect(f.create().hasPending).toBe(false);
  });

  test('concurrent rotation calls share one replacement and one commit', async () => {
    const f = fixture();
    const manager = f.create();
    const peer = remote(f);
    const [a, b] = await Promise.all([manager.rotate(peer.request), manager.rotate(peer.request)]);
    expect(a).toEqual(b);
    expect(peer.calls.filter((c) => c.startsWith('commit:'))).toHaveLength(1);
  });
});
