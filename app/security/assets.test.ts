import { describe, expect, test, vi } from 'vitest';
import {
  createScannerAssetManager,
  type ScannerAssetAuditEvent,
  type ScannerAssetInspection,
  type ScannerAssetProvider,
} from './assets.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createProvider(
  overrides: Partial<ScannerAssetProvider> & Pick<ScannerAssetProvider, 'id'>,
): ScannerAssetProvider {
  return {
    backend: 'docker',
    configuredImage: `scanner.example/${overrides.id}@sha256:abc`,
    inspect: vi.fn(async () => undefined),
    pull: vi.fn(async () => undefined),
    warm: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createScannerAssetManager', () => {
  test('inspects configured providers and returns deterministic status order', async () => {
    const trivy = createProvider({
      id: 'trivy',
      inspect: vi.fn(async () => ({
        resolvedDigest: 'sha256:trivy',
        version: '0.70.0',
        updatedAt: '2026-07-10T01:00:00.000Z',
        cacheUpdatedAt: '2026-07-10T02:00:00.000Z',
        databaseUpdatedAt: '2026-07-10T03:00:00.000Z',
      })),
    });
    const grype = createProvider({ id: 'grype' });
    const syft = createProvider({
      id: 'syft',
      inspect: vi.fn(async () => ({ version: '1.28.0' })),
    });
    const manager = createScannerAssetManager({
      providers: [syft, grype, trivy],
      now: () => new Date('2026-07-12T12:00:00.000Z'),
    });

    const status = await manager.status();

    expect(status.map((entry) => entry.provider)).toEqual(['trivy', 'grype', 'syft']);
    expect(status[0]).toEqual({
      provider: 'trivy',
      backend: 'docker',
      configuredImage: 'scanner.example/trivy@sha256:abc',
      resolvedDigest: 'sha256:trivy',
      version: '0.70.0',
      state: 'ready',
      inspectedAt: '2026-07-12T12:00:00.000Z',
      updatedAt: '2026-07-10T01:00:00.000Z',
      cacheUpdatedAt: '2026-07-10T02:00:00.000Z',
      databaseUpdatedAt: '2026-07-10T03:00:00.000Z',
    });
    expect(status[1]).toMatchObject({ provider: 'grype', state: 'missing' });
    expect(status[2]).toMatchObject({ provider: 'syft', state: 'ready', version: '1.28.0' });
  });

  test('returns cloned snapshots and validates provider ids deterministically', () => {
    const manager = createScannerAssetManager({ providers: [createProvider({ id: 'trivy' })] });
    const snapshot = manager.get('trivy');
    snapshot.state = 'error';

    expect(manager.get('trivy').state).toBe('missing');
    expect(() => manager.get('grype')).toThrow('Scanner asset provider "grype" is not configured');
  });

  test('rejects duplicate and unsupported provider adapters at construction', () => {
    expect(() =>
      createScannerAssetManager({
        providers: [createProvider({ id: 'trivy' }), createProvider({ id: 'trivy' })],
      }),
    ).toThrow('Duplicate scanner asset provider "trivy"');

    expect(() =>
      createScannerAssetManager({
        providers: [createProvider({ id: 'other' as 'trivy' })],
      }),
    ).toThrow('Unsupported scanner asset provider "other"');
  });

  test('publishes pull start and success lifecycle state without retaining auth', async () => {
    const pullDeferred = createDeferred<void>();
    const inspectResult: ScannerAssetInspection = {
      resolvedDigest: 'sha256:pulled',
      version: '0.110.0',
      cacheUpdatedAt: '2026-07-12T10:00:00.000Z',
    };
    const provider = createProvider({
      id: 'grype',
      pull: vi.fn(() => pullDeferred.promise),
      inspect: vi.fn(async () => inspectResult),
    });
    const auditEvents: ScannerAssetAuditEvent[] = [];
    const manager = createScannerAssetManager({
      providers: [provider],
      audit: (event) => auditEvents.push(event),
      now: () => new Date('2026-07-12T12:00:00.000Z'),
    });
    const auth = { username: 'robot', password: 'top-secret' };

    const operation = manager.pull('grype', auth);
    await vi.waitFor(() => expect(provider.pull).toHaveBeenCalledWith(auth));
    const active = manager.get('grype');
    expect(active).toMatchObject({
      provider: 'grype',
      state: 'pulling',
      startedAt: '2026-07-12T12:00:00.000Z',
      operationId: expect.stringContaining('grype:pull'),
    });
    expect(JSON.stringify(active)).not.toContain('top-secret');

    pullDeferred.resolve();
    const completed = await operation;

    expect(completed).toMatchObject({
      provider: 'grype',
      state: 'ready',
      resolvedDigest: 'sha256:pulled',
      version: '0.110.0',
      completedAt: '2026-07-12T12:00:00.000Z',
      operationId: active.operationId,
    });
    expect(auditEvents.map((event) => event.action)).toEqual([
      'scanner-asset-pull-started',
      'scanner-asset-pull-succeeded',
    ]);
    expect(auditEvents[1]?.diagnostics).toMatchObject({
      resolvedDigest: 'sha256:pulled',
      version: '0.110.0',
      cacheUpdatedAt: '2026-07-12T10:00:00.000Z',
    });
    expect(JSON.stringify(auditEvents)).not.toContain('top-secret');
    expect(JSON.stringify(completed)).not.toContain('robot');
  });

  test('coalesces concurrent pulls for the same provider into one operation', async () => {
    const pullDeferred = createDeferred<void>();
    const provider = createProvider({
      id: 'trivy',
      pull: vi.fn(() => pullDeferred.promise),
      inspect: vi.fn(async () => ({ resolvedDigest: 'sha256:one' })),
    });
    const audit = vi.fn();
    const manager = createScannerAssetManager({ providers: [provider], audit });

    const first = manager.pull('trivy');
    const second = manager.pull('trivy');
    await vi.waitFor(() => expect(provider.pull).toHaveBeenCalledTimes(1));
    pullDeferred.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(provider.pull).toHaveBeenCalledTimes(1);
    expect(firstResult.operationId).toBe(secondResult.operationId);
    expect(audit).toHaveBeenCalledTimes(2);
  });

  test('records sanitized failures and permits a later retry', async () => {
    const provider = createProvider({
      id: 'grype',
      pull: vi
        .fn()
        .mockRejectedValueOnce(new Error('\u001b[31mtop-secret\nfailed\u0000'))
        .mockResolvedValueOnce(undefined),
      inspect: vi.fn(async () => ({ resolvedDigest: 'sha256:retry' })),
    });
    const auditEvents: ScannerAssetAuditEvent[] = [];
    const manager = createScannerAssetManager({
      providers: [provider],
      audit: (event) => auditEvents.push(event),
    });

    await expect(
      manager.pull('grype', { username: 'robot', password: 'top-secret' }),
    ).rejects.toThrow('[REDACTED]failed');
    expect(manager.get('grype')).toMatchObject({
      state: 'error',
      lastError: '[REDACTED]failed',
      completedAt: expect.any(String),
    });
    expect(JSON.stringify(auditEvents.at(-1))).not.toContain('top-secret');
    expect(auditEvents.at(-1)).toMatchObject({
      action: 'scanner-asset-pull-failed',
      diagnostics: { error: '[REDACTED]failed' },
    });

    const retried = await manager.pull('grype');
    expect(retried).toMatchObject({ state: 'ready', resolvedDigest: 'sha256:retry' });
    expect(provider.pull).toHaveBeenCalledTimes(2);
  });

  test('coalesces concurrent warm calls and emits warm lifecycle diagnostics', async () => {
    const warmDeferred = createDeferred<void>();
    const provider = createProvider({
      id: 'syft',
      warm: vi.fn(() => warmDeferred.promise),
      inspect: vi.fn(async () => ({
        version: '1.28.0',
        databaseUpdatedAt: '2026-07-12T08:00:00.000Z',
      })),
    });
    const auditEvents: ScannerAssetAuditEvent[] = [];
    const manager = createScannerAssetManager({
      providers: [provider],
      audit: (event) => auditEvents.push(event),
    });

    const first = manager.warm('syft');
    const second = manager.warm('syft');
    await vi.waitFor(() => expect(provider.warm).toHaveBeenCalledTimes(1));
    expect(manager.get('syft').state).toBe('warming');
    warmDeferred.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.operationId).toBe(secondResult.operationId);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'scanner-asset-warm-started',
      'scanner-asset-warm-succeeded',
    ]);
    expect(auditEvents[1]?.diagnostics.databaseUpdatedAt).toBe('2026-07-12T08:00:00.000Z');
  });

  test('warms every configured provider and returns deterministic status order', async () => {
    const trivy = createProvider({
      id: 'trivy',
      inspect: vi.fn(async () => ({ version: 'trivy-version' })),
    });
    const grype = createProvider({
      id: 'grype',
      inspect: vi.fn(async () => ({ version: 'grype-version' })),
    });
    const manager = createScannerAssetManager({ providers: [grype, trivy] });

    const result = await manager.warmConfigured();

    expect(trivy.warm).toHaveBeenCalledOnce();
    expect(grype.warm).toHaveBeenCalledOnce();
    expect(result.map((entry) => entry.provider)).toEqual(['trivy', 'grype']);
    expect(result.every((entry) => entry.state === 'ready')).toBe(true);
  });

  test('serializes unlike operations while coalescing identical queued work', async () => {
    const pullDeferred = createDeferred<void>();
    const provider = createProvider({
      id: 'trivy',
      pull: vi.fn(() => pullDeferred.promise),
      warm: vi.fn(async () => undefined),
      inspect: vi.fn(async () => ({ version: 'ready' })),
    });
    const manager = createScannerAssetManager({ providers: [provider] });

    const pulling = manager.pull('trivy');
    const warmingOne = manager.warm('trivy');
    const warmingTwo = manager.warm('trivy');
    await vi.waitFor(() => expect(provider.pull).toHaveBeenCalledOnce());
    expect(provider.warm).not.toHaveBeenCalled();

    pullDeferred.resolve();
    await Promise.all([pulling, warmingOne, warmingTwo]);

    expect(provider.warm).toHaveBeenCalledOnce();
  });

  test('treats audit delivery as best effort', async () => {
    const provider = createProvider({
      id: 'trivy',
      inspect: vi.fn(async () => ({ version: 'ready' })),
    });
    const manager = createScannerAssetManager({
      providers: [provider],
      audit: vi.fn(async () => {
        throw new Error('audit unavailable');
      }),
    });

    await expect(manager.pull('trivy')).resolves.toMatchObject({ state: 'ready' });
  });

  test('returns the active lifecycle snapshot instead of inspecting during an operation', async () => {
    const pullDeferred = createDeferred<void>();
    const provider = createProvider({
      id: 'trivy',
      pull: vi.fn(() => pullDeferred.promise),
      inspect: vi.fn(async () => ({ resolvedDigest: 'sha256:ready' })),
    });
    const manager = createScannerAssetManager({ providers: [provider] });

    const pulling = manager.pull('trivy');
    await vi.waitFor(() => expect(provider.pull).toHaveBeenCalledOnce());

    await expect(manager.status()).resolves.toEqual([
      expect.objectContaining({ provider: 'trivy', state: 'pulling' }),
    ]);
    expect(provider.inspect).not.toHaveBeenCalled();

    pullDeferred.resolve();
    await pulling;
  });

  test('records inspection failures and missing post-operation assets', async () => {
    const provider = createProvider({
      id: 'grype',
      inspect: vi
        .fn()
        .mockRejectedValueOnce('inspect unavailable')
        .mockResolvedValueOnce(undefined),
    });
    const manager = createScannerAssetManager({ providers: [provider] });

    await expect(manager.status()).resolves.toEqual([
      expect.objectContaining({
        provider: 'grype',
        state: 'error',
        lastError: 'inspect unavailable',
      }),
    ]);

    await expect(manager.pull('grype')).resolves.toMatchObject({
      provider: 'grype',
      state: 'missing',
    });

    provider.pull = vi.fn(async () => {
      throw '';
    });
    await expect(manager.pull('grype')).rejects.toThrow('Unknown scanner asset error');
  });

  test('runs a queued warm after a pull failure and sanitizes absent errors', async () => {
    const provider = createProvider({
      id: 'syft',
      pull: vi.fn(async () => {
        throw undefined;
      }),
      warm: vi.fn(async () => undefined),
      inspect: vi.fn(async () => ({ version: 'ready' })),
    });
    const manager = createScannerAssetManager({ providers: [provider] });

    const pulling = manager.pull('syft');
    const warming = manager.warm('syft');

    await expect(pulling).rejects.toThrow('Unknown scanner asset error');
    await expect(warming).resolves.toMatchObject({ state: 'ready', version: 'ready' });
    expect(provider.warm).toHaveBeenCalledOnce();
  });
});
