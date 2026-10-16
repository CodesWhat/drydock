import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type RotationIdentity,
  type RotationRequest,
  StandardKeyRotation,
} from './standard-key-rotation.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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

test.each([0o500, 0o600, 0o750])('refuses unusable or shared managed directory mode %o', (mode) => {
  const f = fixture();
  fs.chmodSync(f.directory, mode);
  try {
    expect(f.create).toThrow('0700');
  } finally {
    fs.chmodSync(f.directory, 0o700);
  }
});

function managedFile(f: ReturnType<typeof fixture>) {
  return path.join(
    f.directory,
    createHash('sha256').update(`remote/production\n${f.bootstrap.keyId}`).digest('hex') + '.json',
  );
}

test('rejects an empty persisted pending private key before accepting traffic', () => {
  const f = fixture();
  fs.writeFileSync(
    managedFile(f),
    JSON.stringify({
      version: 1,
      rootKeyId: f.bootstrap.keyId,
      currentPem: f.bootstrap.privatePem,
      pendingPem: '',
    }),
    { mode: 0o600 },
  );
  expect(f.create).toThrow();
});

test('rejects malformed remote status without changing the active signer', async () => {
  const f = fixture();
  const manager = f.create();
  await expect(manager.rotate(async () => null as never)).rejects.toThrow('status did not match');
  expect(manager.identity.keyId).toBe(f.bootstrap.keyId);
  expect(manager.hasPending).toBe(true);
});

test.each([
  null,
  { version: 2 },
  { version: 1, rootKeyId: 'different' },
  { version: 1, currentPem: 7 },
  { version: 1, pendingPem: 7 },
])('refuses incompatible managed state %j', (overrides) => {
  const f = fixture();
  const state =
    overrides === null
      ? null
      : {
          version: 1,
          rootKeyId: f.bootstrap.keyId,
          currentPem: f.bootstrap.privatePem,
          ...overrides,
        };
  fs.writeFileSync(managedFile(f), JSON.stringify(state), { mode: 0o600 });
  expect(f.create).toThrow('Invalid managed');
});

test('refuses malformed JSON, oversized or exposed private state and duplicate keys', () => {
  const f = fixture();
  const file = managedFile(f);
  fs.writeFileSync(file, '{', { mode: 0o600 });
  expect(f.create).toThrow('Invalid managed');
  fs.writeFileSync(file, ' '.repeat(65537));
  expect(f.create).toThrow('regular private file');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      rootKeyId: f.bootstrap.keyId,
      currentPem: f.bootstrap.privatePem,
      pendingPem: f.bootstrap.privatePem,
    }),
  );
  expect(f.create).toThrow('must differ');
  fs.chmodSync(file, 0o644);
  expect(f.create).toThrow('regular private file');
});

test('refuses a mismatched bootstrap ID and a symlink directory', () => {
  const f = fixture();
  expect(
    () => new StandardKeyRotation(f.directory, 'host', { ...f.bootstrap, keyId: 'wrong' }),
  ).toThrow('does not match');
  const link = `${f.directory}-link`;
  fs.symlinkSync(f.directory, link);
  try {
    expect(() => new StandardKeyRotation(link, 'host', f.bootstrap)).toThrow('0700');
  } finally {
    fs.unlinkSync(link);
  }
});

test('an unreadable managed file fails closed', () => {
  const f = fixture();
  const file = managedFile(f);
  fs.writeFileSync(file, '{}', { mode: 0o000 });
  try {
    expect(f.create).toThrow();
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

test('a failed local stage does not send any remote request or leak a temporary credential', async () => {
  const f = fixture();
  const manager = f.create();
  const request = vi.fn();
  const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  await expect(manager.rotate(request)).rejects.toThrow('disk full');
  write.mockRestore();
  expect(request).not.toHaveBeenCalled();
  expect(manager.hasPending).toBe(false);
  expect(fs.readdirSync(f.directory)).toEqual([]);
});

test('a failed final local write keeps the accepted replacement usable and recovers after restart', async () => {
  const f = fixture();
  const manager = f.create();
  const peer = remote(f);
  let committedId = '';
  await expect(
    manager.rotate(async (identity, action, body) => {
      const status = await peer.request(identity, action, body);
      if (action === 'commit') {
        committedId = identity.keyId;
        vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
          throw new Error('disk unavailable');
        });
      }
      return status;
    }),
  ).rejects.toThrow('disk unavailable');
  vi.restoreAllMocks();
  expect(manager.identity.keyId).toBe(committedId);
  const recovered = f.create();
  expect((await recovered.rotate(peer.request)).current_key_id).toBe(committedId);
});

test('a replaced controller instance cannot overwrite newer staged credentials', async () => {
  const f = fixture();
  const stale = f.create();
  const owner = f.create();
  await expect(
    owner.rotate(async () => {
      throw new Error('offline');
    }),
  ).rejects.toThrow('offline');
  const pending = owner.status().pending_key_id;
  await expect(
    stale.rotate(async () => {
      throw new Error('must not call');
    }),
  ).rejects.toThrow('changed');
  expect(f.create().status().pending_key_id).toBe(pending);
});

test('refuses a different remote pending key without replacing either credential', async () => {
  const f = fixture();
  const manager = f.create();
  await expect(
    manager.rotate(async () => ({
      root_key_id: f.bootstrap.keyId,
      current_key_id: f.bootstrap.keyId,
      pending_key_id: 'different',
    })),
  ).rejects.toThrow('different pending');
  expect(manager.identity.keyId).toBe(f.bootstrap.keyId);
});

test.each(['root', 'current', 'pending'])('refuses remote %s identity mismatch', async (field) => {
  const f = fixture();
  const manager = f.create();
  const peer = remote(f);
  await expect(
    manager.rotate(async (identity, action, body) => {
      const status = await peer.request(identity, action, body);
      if (action === 'prepare') {
        if (field === 'root') status.root_key_id = 'wrong';
        if (field === 'current') status.current_key_id = 'wrong';
        if (field === 'pending') status.pending_key_id = 'wrong';
      }
      return status;
    }),
  ).rejects.toThrow('status did not match');
  expect(peer.keys.has(f.bootstrap.keyId)).toBe(true);
});

test('refuses abort during an in-flight rotation and shares concurrent recovery work', async () => {
  const f = fixture();
  const manager = f.create();
  const peer = remote(f);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = manager.rotate(async (identity, action, body) => {
    await gate;
    return peer.request(identity, action, body);
  });
  const b = manager.rotate(peer.request);
  await expect(manager.abort(peer.request)).rejects.toThrow('already running');
  release();
  expect(await a).toEqual(await b);
});
