import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as keys from './agent-keys.js';
import type { Database } from './db/driver.js';
import * as bindings from './name-bindings.js';

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
function owner() {
  const old = keys.addKey(pub(), 'production');
  bindings.upsertBinding('production', old.keyId, Date.now());
  return old;
}

test('stages an agent-bound replacement while retaining the original key', () => {
  const old = owner();
  const replacement = pub();
  const next = keys.addRotationKey(old.keyId, 'production', replacement);
  expect(keys.getKey(old.keyId)).not.toBeNull();
  expect(keys.getKey(next.keyId)).toMatchObject({
    rotationParentId: old.keyId,
    rotationAgentName: 'production',
  });
  expect(keys.getPendingRotation(old.keyId, 'production')?.keyId).toBe(next.keyId);
  expect(keys.addRotationKey(old.keyId, 'production', replacement).keyId).toBe(next.keyId);
  expect(() => keys.addRotationKey(old.keyId, 'production', pub())).toThrow('pending');
});

test('successful proof transfers only the intended binding and retires the old key atomically', () => {
  const old = owner();
  const independent = keys.addKey(pub(), 'other');
  bindings.upsertBinding('other', independent.keyId, Date.now());
  const next = keys.addRotationKey(old.keyId, 'production', pub());
  expect(keys.confirmRotationKey(next.keyId, 'production')).toBe(old.keyId);
  expect(keys.getKey(old.keyId)).toBeNull();
  expect(keys.getKey(next.keyId)).not.toHaveProperty('rotationParentId');
  expect(keys.getKey(independent.keyId)).not.toBeNull();
  expect(bindings.listBindings()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ agentName: 'production', keyId: next.keyId }),
      expect.objectContaining({ agentName: 'other', keyId: independent.keyId }),
    ]),
  );
});

test('shared keys and unrelated names cannot be rotated or stolen', () => {
  const old = owner();
  expect(() => keys.addRotationKey(old.keyId, 'unrelated', pub())).toThrow('exclusive');
  bindings.upsertBinding('second-host', old.keyId, Date.now());
  expect(() => keys.addRotationKey(old.keyId, 'production', pub())).toThrow('exclusive');
  expect(keys.getKey(old.keyId)).not.toBeNull();
  expect(keys.listKeys()).toHaveLength(1);
});

test('a failed binding write rolls back both revocation and successor promotion', () => {
  const old = owner();
  const next = keys.addRotationKey(old.keyId, 'production', pub());
  db.exec(
    "CREATE TRIGGER reject_handoff BEFORE UPDATE ON name_bindings BEGIN SELECT RAISE(ABORT, 'fixture denied'); END;",
  );
  expect(() => keys.confirmRotationKey(next.keyId, 'production')).toThrow('fixture denied');
  expect(keys.getKey(old.keyId)).not.toBeNull();
  expect(keys.getKey(next.keyId)?.rotationParentId).toBe(old.keyId);
  expect(bindings.listBindings()[0].keyId).toBe(old.keyId);
});

test('operator revocation also rejects the unconfirmed replacement', () => {
  const old = owner();
  const next = keys.addRotationKey(old.keyId, 'production', pub());
  expect(keys.revokeKey(old.keyId)).toBe(true);
  expect(keys.getKey(old.keyId)).toBeNull();
  expect(keys.getKey(next.keyId)).toBeNull();
  expect(() => keys.confirmRotationKey(next.keyId, 'production')).toThrow();
});

test('abort revokes only the staged key and keeps the original binding', () => {
  const old = owner();
  const next = keys.addRotationKey(old.keyId, 'production', pub());
  keys.cancelRotationKey(old.keyId, 'production');
  expect(keys.getKey(old.keyId)).not.toBeNull();
  expect(keys.getKey(next.keyId)).toBeNull();
  expect(keys.getPendingRotation(old.keyId, 'production')).toBeNull();
  expect(bindings.listBindings()[0].keyId).toBe(old.keyId);
});

test('ordinary active identities do not confirm a nonexistent replacement', () => {
  const old = owner();
  expect(keys.confirmRotationKey(old.keyId, 'production')).toBeUndefined();
  expect(keys.cancelRotationKey(old.keyId, 'production')).toBe(false);
  const next = keys.addRotationKey(old.keyId, 'production', pub());
  expect(() => keys.confirmRotationKey(next.keyId, 'different')).toThrow('different agent');
  expect(() => keys.assertExclusiveRotationOwner(next.keyId, 'production')).toThrow('exclusive');
});

test.each(['agent_keys', 'name_bindings'])(
  'a skipped %s update rolls the full handoff back',
  (table) => {
    const old = owner();
    const next = keys.addRotationKey(old.keyId, 'production', pub());
    db.exec(
      `CREATE TRIGGER skip_handoff BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    expect(() => keys.confirmRotationKey(next.keyId, 'production')).toThrow('ownership changed');
    expect(keys.getKey(old.keyId)).not.toBeNull();
    expect(keys.getKey(next.keyId)?.rotationParentId).toBe(old.keyId);
    expect(bindings.listBindings()[0].keyId).toBe(old.keyId);
  },
);

test('rotation operations fail closed before the registry is initialized', async () => {
  vi.resetModules();
  const uninitialized = await import('./agent-keys.js');
  expect(() => uninitialized.addRotationKey('old', 'production', pub())).toThrow('not initialized');
  expect(() => uninitialized.confirmRotationKey('new', 'production')).toThrow('not initialized');
  expect(() => uninitialized.cancelRotationKey('old', 'production')).toThrow('not initialized');
});
