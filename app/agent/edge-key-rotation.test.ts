import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as keys from '../store/agent-keys.js';
import type { Database } from '../store/db/driver.js';
import * as bindings from '../store/name-bindings.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { EdgeKeyRotationController } from './edge-key-rotation.js';

let db: Database;
beforeEach(() => {
  db = createMigratedMemoryDatabase();
  keys.createCollections(db);
  bindings.createCollections(db);
});
afterEach(() => {
  db.close();
  bindings.clearCollectionForTesting();
});
function pub() {
  return generateKeyPairSync('ed25519')
    .publicKey.export({ type: 'spki', format: 'der' })
    .subarray(-32);
}
function fixture() {
  const old = keys.addKey(pub(), 'host');
  bindings.upsertBinding('host', old.keyId, Date.now());
  const next = pub();
  const nextId = createHash('sha256').update(next).digest('hex').slice(0, 16);
  const close = vi.fn();
  const request = vi.fn(async (_method: string, target: string, body: unknown) => ({
    statusCode: 200,
    body: {
      root_key_id: old.keyId,
      current_key_id: old.keyId,
      ...(target.endsWith('/abort')
        ? {}
        : { pending_key_id: nextId, pending_public_key: next.toString('base64') }),
      activation_pending:
        target.endsWith('/activate') && (body as { key_id?: string }).key_id === nextId,
    },
  }));
  const controller = new EdgeKeyRotationController('host', old.keyId, request, close);
  return { old, next, nextId, close, request, controller };
}

test('Edge rotation stages both sides and requests reconnect without retiring the unproven key', async () => {
  const f = fixture();
  const result = await f.controller.rotate('rotate');
  expect(result).toMatchObject({
    phase: 'awaiting-reconnect',
    current_key_id: f.old.keyId,
    pending_key_id: f.nextId,
  });
  expect(f.close).toHaveBeenCalledOnce();
  expect(keys.getKey(f.old.keyId)).not.toBeNull();
  expect(keys.getKey(f.nextId)).toMatchObject({
    rotationParentId: f.old.keyId,
    rotationAgentName: 'host',
  });
  expect(f.request.mock.calls.map((call) => call[1])).toEqual([
    '/_portwing/auth/rotation/edge/prepare',
    '/_portwing/auth/rotation/edge/activate',
  ]);
});

test('failed activation retains the original key and recoverable staged metadata', async () => {
  const f = fixture();
  f.request.mockImplementationOnce(async () => ({
    statusCode: 200,
    body: {
      root_key_id: f.old.keyId,
      current_key_id: f.old.keyId,
      pending_key_id: f.nextId,
      pending_public_key: f.next.toString('base64'),
      activation_pending: false,
    },
  }));
  f.request.mockRejectedValueOnce(new Error('activation unavailable'));
  await expect(f.controller.rotate('rotate')).rejects.toThrow('activation unavailable');
  expect(keys.getKey(f.old.keyId)).not.toBeNull();
  expect(keys.getPendingRotation(f.old.keyId, 'host')?.keyId).toBe(f.nextId);
  expect(f.close).not.toHaveBeenCalled();
});

test('abort revokes only the staged successor after the agent acknowledges cancellation', async () => {
  const f = fixture();
  keys.addRotationKey(f.old.keyId, 'host', f.next);
  const result = await f.controller.rotate('abort');
  expect(result.current_key_id).toBe(f.old.keyId);
  expect(keys.getKey(f.old.keyId)).not.toBeNull();
  expect(keys.getKey(f.nextId)).toBeNull();
  expect(f.close).not.toHaveBeenCalled();
});

test('shared-key refusal happens before any agent mutation', async () => {
  const f = fixture();
  bindings.upsertBinding('second-host', f.old.keyId, Date.now());
  await expect(f.controller.rotate('rotate')).rejects.toThrow('exclusive');
  expect(f.request).not.toHaveBeenCalled();
  expect(keys.getKey(f.old.keyId)).not.toBeNull();
});

test('agent key-ID/public-key mismatch never authorizes a new key', async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    statusCode: 200,
    body: {
      root_key_id: f.old.keyId,
      current_key_id: f.old.keyId,
      pending_key_id: '0000000000000000',
      pending_public_key: f.next.toString('base64'),
      activation_pending: false,
    },
  });
  await expect(f.controller.rotate('rotate')).rejects.toThrow('replacement');
  expect(keys.listKeys()).toHaveLength(1);
  expect(f.close).not.toHaveBeenCalled();
});

test.each([
  null,
  {},
  { statusCode: '200' },
  { statusCode: 199 },
  { statusCode: 300 },
  { statusCode: 200, body: null },
  { statusCode: 200, body: [] },
  { statusCode: 200, body: {} },
  { statusCode: 200, body: { current_key_id: 1 } },
  { statusCode: 200, bodyBase64: 'eA==' },
])('refuses malformed or unsuccessful peer responses %j', async (response) => {
  const f = fixture();
  const controller = new EdgeKeyRotationController(
    'host',
    f.old.keyId,
    async () => response,
    f.close,
  );
  await expect(controller.rotate('rotate')).rejects.toThrow();
  expect(f.close).not.toHaveBeenCalled();
  expect(keys.getKey(f.old.keyId)).not.toBeNull();
  expect(keys.getPendingRotation(f.old.keyId, 'host')).toBeNull();
});

test.each(['current', 'missing-public', 'length', 'encoding'])(
  'refuses unbound replacement material: %s',
  async (fault) => {
    const f = fixture();
    const body = {
      current_key_id: f.old.keyId,
      pending_key_id: f.nextId,
      pending_public_key: f.next.toString('base64'),
    };
    if (fault === 'current') body.current_key_id = 'wrong';
    if (fault === 'missing-public')
      delete (body as { pending_public_key?: string }).pending_public_key;
    if (fault === 'length') body.pending_public_key = Buffer.from('short').toString('base64');
    if (fault === 'encoding') body.pending_public_key += '\n';
    const controller = new EdgeKeyRotationController(
      'host',
      f.old.keyId,
      async () => ({ statusCode: 200, body }),
      f.close,
    );
    await expect(controller.rotate('rotate')).rejects.toThrow();
    expect(keys.getPendingRotation(f.old.keyId, 'host')).toBeNull();
    expect(f.close).not.toHaveBeenCalled();
  },
);

test.each(['current', 'pending', 'activation'])(
  'retains the old key when activation acknowledgement mismatches %s',
  async (fault) => {
    const f = fixture();
    const controller = new EdgeKeyRotationController(
      'host',
      f.old.keyId,
      async (_method, target) => ({
        statusCode: 200,
        body: {
          current_key_id:
            target.endsWith('/activate') && fault === 'current' ? 'wrong' : f.old.keyId,
          pending_key_id: target.endsWith('/activate') && fault === 'pending' ? 'wrong' : f.nextId,
          pending_public_key: f.next.toString('base64'),
          activation_pending: target.endsWith('/activate') && fault !== 'activation',
        },
      }),
      f.close,
    );
    await expect(controller.rotate('rotate')).rejects.toThrow('acknowledge');
    expect(keys.getKey(f.old.keyId)).not.toBeNull();
    expect(keys.getPendingRotation(f.old.keyId, 'host')?.keyId).toBe(f.nextId);
    expect(f.close).not.toHaveBeenCalled();
  },
);

test.each(['current', 'pending'])('refuses unconfirmed cancellation: %s', async (fault) => {
  const f = fixture();
  keys.addRotationKey(f.old.keyId, 'host', f.next);
  const controller = new EdgeKeyRotationController(
    'host',
    f.old.keyId,
    async () => ({
      statusCode: 200,
      body: {
        current_key_id: fault === 'current' ? 'wrong' : f.old.keyId,
        pending_key_id: fault === 'pending' ? f.nextId : undefined,
      },
    }),
    f.close,
  );
  await expect(controller.rotate('abort')).rejects.toThrow('acknowledge');
  expect(keys.getKey(f.nextId)).not.toBeNull();
});

test('honors negotiated base64 responses and single-flights concurrent rotations', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new EdgeKeyRotationController(
    'host',
    f.old.keyId,
    async (method, target, body) => {
      await gate;
      const reply = await f.request(method, target, body);
      return {
        statusCode: 200,
        bodyBase64: Buffer.from(JSON.stringify(reply.body)).toString('base64'),
      };
    },
    f.close,
  );
  const a = controller.rotate('rotate');
  const b = controller.rotate('rotate');
  await expect(controller.rotate('abort')).rejects.toThrow('already running');
  release();
  expect(await a).toEqual(await b);
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledOnce();
});
