import {
  buildComposeProjectLockKey,
  buildContainerLockKey,
  getUpdateLockSnapshot,
  hasUpdateConcurrencyCap,
  parseMaxConcurrent,
  withContainerUpdateLocks,
} from './update-locks.js';

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const deferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitForCondition = async (
  predicate: () => boolean,
  description: string,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
};

describe('buildContainerLockKey', () => {
  test('namespaces the lock key by watcher and container name', () => {
    expect(buildContainerLockKey({ name: 'web', watcher: 'local' })).toBe('container:local:web');
  });
});

describe('buildComposeProjectLockKey', () => {
  test('namespaces the lock key by watcher and project', () => {
    expect(buildComposeProjectLockKey({ name: 'web', watcher: 'local' }, 'myproj')).toBe(
      'compose:local:myproj',
    );
  });
});

describe('parseMaxConcurrent', () => {
  test('returns null for undefined (absent env var)', () => {
    expect(parseMaxConcurrent(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseMaxConcurrent('')).toBeNull();
  });

  test('returns null for "0" (unlimited)', () => {
    expect(parseMaxConcurrent('0')).toBeNull();
  });

  test('returns null for "  0  " (whitespace-padded zero)', () => {
    expect(parseMaxConcurrent('  0  ')).toBeNull();
  });

  test('returns 1 for "1"', () => {
    expect(parseMaxConcurrent('1')).toBe(1);
  });

  test('returns 5 for "5"', () => {
    expect(parseMaxConcurrent('5')).toBe(5);
  });

  test('returns 10 for "10"', () => {
    expect(parseMaxConcurrent('10')).toBe(10);
  });

  test('throws for negative value "-1"', () => {
    expect(() => parseMaxConcurrent('-1')).toThrow(
      'DD_UPDATE_MAX_CONCURRENT must be a non-negative integer (got "-1")',
    );
  });

  test('throws for non-numeric "abc"', () => {
    expect(() => parseMaxConcurrent('abc')).toThrow(
      'DD_UPDATE_MAX_CONCURRENT must be a non-negative integer (got "abc")',
    );
  });

  test('throws for float "1.5"', () => {
    expect(() => parseMaxConcurrent('1.5')).toThrow(
      'DD_UPDATE_MAX_CONCURRENT must be a non-negative integer (got "1.5")',
    );
  });

  test('throws for mixed value "2x"', () => {
    expect(() => parseMaxConcurrent('2x')).toThrow(
      'DD_UPDATE_MAX_CONCURRENT must be a non-negative integer',
    );
  });

  test('throws for a number that exceeds MAX_SAFE_INTEGER', () => {
    // 2^53 passes the digit-only regex but fails isSafeInteger.
    const huge = String(Number.MAX_SAFE_INTEGER + 1);
    expect(() => parseMaxConcurrent(huge)).toThrow(
      'DD_UPDATE_MAX_CONCURRENT must be a non-negative integer',
    );
  });
});

describe('hasUpdateConcurrencyCap', () => {
  test('returns false when DD_UPDATE_MAX_CONCURRENT is unset (default unlimited)', () => {
    // Module under test was loaded with no env var set, so the module-level
    // semaphore is null and `hasUpdateConcurrencyCap()` should be false.
    expect(hasUpdateConcurrencyCap()).toBe(false);
  });

  test('returns true after dynamic import with DD_UPDATE_MAX_CONCURRENT set', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '2';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap2');
      expect(mod.hasUpdateConcurrencyCap()).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('returns false after dynamic import with DD_UPDATE_MAX_CONCURRENT="0"', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '0';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap0');
      expect(mod.hasUpdateConcurrencyCap()).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });
});

describe('withContainerUpdateLocks (no global semaphore — default unlimited)', () => {
  test('runs fn under the singleton lock manager and returns its value', async () => {
    const result = await withContainerUpdateLocks(['container:local:a'], async () => 'ok');
    expect(result).toBe('ok');
    const snap = getUpdateLockSnapshot();
    expect(snap.held).toEqual([]);
    expect(snap.pending).toEqual([]);
  });

  test('serialises two callers contending on the same key', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const aStarted = deferred();

    const keys = ['container:local:shared'];
    const a = withContainerUpdateLocks(keys, async () => {
      order.push('a-start');
      aStarted.resolve();
      await gate;
      order.push('a-end');
    });
    await aStarted.promise;

    const b = withContainerUpdateLocks(keys, async () => {
      order.push('b');
    });
    await waitForCondition(
      () => getUpdateLockSnapshot().pending.some((entry) => entry.key === keys[0]),
      'second caller to wait on the shared container key',
    );

    release();
    await Promise.all([a, b]);

    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  test('lets disjoint keys run concurrently', async () => {
    let aStarted = false;
    let bStarted = false;
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const aStartedDeferred = deferred();
    const bStartedDeferred = deferred();

    const a = withContainerUpdateLocks(['container:local:disjoint-a'], async () => {
      aStarted = true;
      aStartedDeferred.resolve();
      await aGate;
    });
    const b = withContainerUpdateLocks(['container:local:disjoint-b'], async () => {
      bStarted = true;
      bStartedDeferred.resolve();
      await bGate;
    });
    await Promise.all([aStartedDeferred.promise, bStartedDeferred.promise]);

    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);

    releaseA();
    releaseB();
    await Promise.all([a, b]);
  });

  test('exposes a snapshot of held locks while in use', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holderStarted = deferred();

    const a = withContainerUpdateLocks(['container:local:snapshot'], async () => {
      holderStarted.resolve();
      await gate;
    });
    await holderStarted.promise;

    expect(getUpdateLockSnapshot().held).toContain('container:local:snapshot');

    release();
    await a;

    expect(getUpdateLockSnapshot().held).toEqual([]);
    expect(getUpdateLockSnapshot().pending).toEqual([]);
  });

  test('snapshot does not include semaphore field when cap is not configured', () => {
    const snap = getUpdateLockSnapshot();
    expect(snap.semaphore).toBeUndefined();
  });

  test('compose update holding compose and container keys blocks a solo update on the same container key', async () => {
    const order: string[] = [];
    const releaseCompose = deferred();
    const composeStarted = deferred();
    const composeProjectKey = buildComposeProjectLockKey(
      { name: 'web', watcher: 'local' },
      'stack',
    );
    const containerKey = buildContainerLockKey({ name: 'web', watcher: 'local' });

    const compose = withContainerUpdateLocks([composeProjectKey, containerKey], async () => {
      order.push('compose-start');
      composeStarted.resolve();
      await releaseCompose.promise;
      order.push('compose-end');
    });
    await composeStarted.promise;

    const solo = withContainerUpdateLocks([containerKey], async () => {
      order.push('solo-container');
    });

    await waitForCondition(() => {
      const snap = getUpdateLockSnapshot();
      return (
        snap.held.includes(composeProjectKey) &&
        snap.held.includes(containerKey) &&
        snap.pending.some((entry) => entry.key === containerKey && entry.waiters === 1)
      );
    }, 'solo container update to wait while compose update holds both keys');

    expect(order).toEqual(['compose-start']);

    releaseCompose.resolve();
    await Promise.all([compose, solo]);

    expect(order).toEqual(['compose-start', 'compose-end', 'solo-container']);
    expect(getUpdateLockSnapshot()).toMatchObject({ held: [], pending: [] });
  });
});

describe('withContainerUpdateLocks (exclusive lifecycle coordination)', () => {
  test('drains active updates and grants a waiting exclusive update before later regular updates', async () => {
    const order: string[] = [];
    const regularStarted = deferred();
    const releaseRegular = deferred();
    const exclusiveStarted = deferred();
    const releaseExclusive = deferred();

    const regular = withContainerUpdateLocks(['container:local:regular-active'], async () => {
      order.push('regular-start');
      regularStarted.resolve();
      await releaseRegular.promise;
      order.push('regular-end');
    });
    await regularStarted.promise;

    const exclusive = withContainerUpdateLocks(
      ['container:local:self'],
      async () => {
        order.push('exclusive-start');
        exclusiveStarted.resolve();
        await releaseExclusive.promise;
        order.push('exclusive-end');
      },
      { bypassGlobalCap: true, exclusive: true },
    );
    const laterRegularOne = withContainerUpdateLocks(
      ['container:local:regular-later-1'],
      async () => {
        order.push('later-regular-1');
      },
    );
    const laterRegularTwo = withContainerUpdateLocks(
      ['container:local:regular-later-2'],
      async () => {
        order.push('later-regular-2');
      },
    );

    releaseRegular.resolve();
    await exclusiveStarted.promise;
    expect(order).toEqual(['regular-start', 'regular-end', 'exclusive-start']);

    releaseExclusive.resolve();
    await Promise.all([regular, exclusive, laterRegularOne, laterRegularTwo]);

    expect(order).toEqual([
      'regular-start',
      'regular-end',
      'exclusive-start',
      'exclusive-end',
      'later-regular-1',
      'later-regular-2',
    ]);
  }, 1_000);

  test('retains exclusive ownership after a successful handoff until module restart', async () => {
    vi.resetModules();
    const retainedModule = await import('./update-locks.js?retained-exclusive');
    let queuedRegularStarted = false;

    await retainedModule.withContainerUpdateLocks(
      ['container:local:self-retained'],
      async () => true,
      {
        bypassGlobalCap: true,
        exclusive: true,
        retainExclusiveOnResult: (result) =>
          result === true ? { operationId: 'self-retained' } : undefined,
      },
    );
    void retainedModule.withContainerUpdateLocks(
      ['container:local:regular-blocked-after-handoff'],
      async () => {
        queuedRegularStarted = true;
      },
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(queuedRegularStarted).toBe(false);

    vi.resetModules();
    const restartedModule = await import('./update-locks.js?after-retained-exclusive');
    await restartedModule.withContainerUpdateLocks(
      ['container:local:regular-after-restart'],
      async () => {
        queuedRegularStarted = true;
      },
    );
    expect(queuedRegularStarted).toBe(true);
  });

  test('releases exclusive ownership when the result does not request retention', async () => {
    const result = await withContainerUpdateLocks(
      ['container:local:self-dry-run'],
      async () => false,
      {
        bypassGlobalCap: true,
        exclusive: true,
        retainExclusiveOnResult: (updated) =>
          updated !== false ? { operationId: 'self-dry-run' } : undefined,
      },
    );
    let regularStarted = false;

    await withContainerUpdateLocks(['container:local:regular-after-dry-run'], async () => {
      regularStarted = true;
    });

    expect(result).toBe(false);
    expect(regularStarted).toBe(true);
  });

  test('releases exclusive ownership when the exclusive update rejects', async () => {
    const failure = new Error('helper start failed');

    await expect(
      withContainerUpdateLocks(
        ['container:local:self-failed'],
        async () => {
          throw failure;
        },
        {
          bypassGlobalCap: true,
          exclusive: true,
          retainExclusiveOnResult: () => ({ operationId: 'self-failed' }),
        },
      ),
    ).rejects.toBe(failure);

    await expect(
      withContainerUpdateLocks(['container:local:regular-after-self-failure'], async () => 'ran'),
    ).resolves.toBe('ran');
  });

  test('releases a retained self-update lifecycle once and drains queued regular work', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?rollback-release');
    let regularStarted = false;

    await mod.withContainerUpdateLocks(['container:local:self-rollback'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: (result) =>
        result === true ? { operationId: 'self-rollback' } : undefined,
    });
    const regular = mod.withContainerUpdateLocks(
      ['container:local:regular-after-rollback'],
      async () => {
        regularStarted = true;
      },
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(mod.getUpdateLockSnapshot().lifecycle).toMatchObject({
      exclusiveActive: true,
      retainedExclusive: true,
      retainedOperationId: 'self-rollback',
      pending: 1,
    });
    mod.releaseRetainedSelfUpdateLifecycle('stale-operation');
    expect(mod.getUpdateLockSnapshot().lifecycle?.pending).toBe(1);
    mod.releaseRetainedSelfUpdateLifecycle('self-rollback');
    mod.releaseRetainedSelfUpdateLifecycle('self-rollback');
    await regular;

    expect(regularStarted).toBe(true);
    expect(mod.getUpdateLockSnapshot().lifecycle).toBeUndefined();
  });

  test('does not let a stale callback release a newer retained self-update lease', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?stale-release');

    await mod.withContainerUpdateLocks(['container:local:self-old'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: () => ({ operationId: 'self-old' }),
    });
    mod.releaseRetainedSelfUpdateLifecycle('self-old');

    await mod.withContainerUpdateLocks(['container:local:self-new'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: () => ({ operationId: 'self-new' }),
    });
    const regular = mod.withContainerUpdateLocks(['container:local:after-new'], async () => 'ran');
    await new Promise<void>((resolve) => setImmediate(resolve));

    mod.releaseRetainedSelfUpdateLifecycle('self-old');
    expect(mod.getUpdateLockSnapshot().lifecycle?.pending).toBe(1);

    mod.releaseRetainedSelfUpdateLifecycle('self-new');
    await expect(regular).resolves.toBe('ran');
  });

  test('consumes an early matching release from the active exclusive lifecycle', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?early-release');
    const selfUpdate = mod.withContainerUpdateLocks(
      ['container:local:self-early'],
      async () => {
        mod.releaseRetainedSelfUpdateLifecycle('self-early');
        return true;
      },
      {
        bypassGlobalCap: true,
        exclusive: true,
        retainExclusiveOnResult: () => ({ operationId: 'self-early' }),
      },
    );
    await selfUpdate;

    await expect(
      mod.withContainerUpdateLocks(['container:local:regular-after-early'], async () => 'ran'),
    ).resolves.toBe('ran');
    expect(mod.getUpdateLockSnapshot().lifecycle).toBeUndefined();
  });

  test('clears unrelated early releases before retaining the active operation', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?early-unrelated');
    await expect(
      mod.withContainerUpdateLocks(
        ['container:local:self-unrelated'],
        async () => {
          mod.releaseRetainedSelfUpdateLifecycle('stale-operation');
          return true;
        },
        {
          bypassGlobalCap: true,
          exclusive: true,
          retainExclusiveOnResult: () => ({ operationId: 'self-unrelated' }),
        },
      ),
    ).resolves.toBe(true);

    const regular = mod.withContainerUpdateLocks(
      ['container:local:regular-unrelated'],
      async () => 'ran',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mod.getUpdateLockSnapshot().lifecycle?.retainedOperationId).toBe('self-unrelated');
    mod.releaseRetainedSelfUpdateLifecycle('self-unrelated');
    await expect(regular).resolves.toBe('ran');
  });

  test('clears early releases when the active lifecycle fails or does not retain', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?early-clear');

    await expect(
      mod.withContainerUpdateLocks(
        ['container:local:self-failed-early'],
        async () => {
          mod.releaseRetainedSelfUpdateLifecycle('self-failed-early');
          throw new Error('lifecycle failed');
        },
        {
          bypassGlobalCap: true,
          exclusive: true,
          retainExclusiveOnResult: () => ({ operationId: 'self-failed-early' }),
        },
      ),
    ).rejects.toThrow('lifecycle failed');

    await mod.withContainerUpdateLocks(
      ['container:local:self-dryrun-early'],
      async () => {
        mod.releaseRetainedSelfUpdateLifecycle('self-dryrun-early');
        return false;
      },
      {
        bypassGlobalCap: true,
        exclusive: true,
        retainExclusiveOnResult: (result) =>
          result ? { operationId: 'self-dryrun-early' } : undefined,
      },
    );

    await mod.withContainerUpdateLocks(['container:local:self-after-dryrun'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: () => ({ operationId: 'self-dryrun-early' }),
    });
    const regular = mod.withContainerUpdateLocks(
      ['container:local:after-early-clear'],
      async () => 'ran',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mod.getUpdateLockSnapshot().lifecycle?.pending).toBe(1);
    mod.releaseRetainedSelfUpdateLifecycle('self-dryrun-early');
    await expect(regular).resolves.toBe('ran');
  });

  test.each([
    ['matching-then-stale', ['self-order', 'stale-order']],
    ['stale-then-matching', ['stale-order', 'self-order']],
  ])('preserves a matching early release across callback order: %s', async (_name, callbacks) => {
    vi.resetModules();
    const mod =
      _name === 'matching-then-stale'
        ? await import('./update-locks.js?early-order-matching')
        : await import('./update-locks.js?early-order-stale');

    await mod.withContainerUpdateLocks(
      ['container:local:self-order'],
      async () => {
        for (const operationId of callbacks) {
          mod.releaseRetainedSelfUpdateLifecycle(operationId);
        }
        return true;
      },
      {
        bypassGlobalCap: true,
        exclusive: true,
        retainExclusiveOnResult: () => ({ operationId: 'self-order' }),
      },
    );

    await expect(
      mod.withContainerUpdateLocks(['container:local:regular-after-order'], async () => 'ran'),
    ).resolves.toBe('ran');
    expect(mod.getUpdateLockSnapshot().lifecycle).toBeUndefined();
  });

  test('ignores a wrong release after retention without affecting a later lifecycle', async () => {
    vi.resetModules();
    const mod = await import('./update-locks.js?post-retention-wrong');

    await mod.withContainerUpdateLocks(['container:local:self-retained-first'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: () => ({ operationId: 'self-retained-first' }),
    });
    mod.releaseRetainedSelfUpdateLifecycle('wrong-after-retention');
    const firstRegular = mod.withContainerUpdateLocks(
      ['container:local:regular-after-first'],
      async () => 'first-ran',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mod.getUpdateLockSnapshot().lifecycle?.pending).toBe(1);
    mod.releaseRetainedSelfUpdateLifecycle('self-retained-first');
    await expect(firstRegular).resolves.toBe('first-ran');

    await mod.withContainerUpdateLocks(['container:local:self-retained-second'], async () => true, {
      bypassGlobalCap: true,
      exclusive: true,
      retainExclusiveOnResult: () => ({ operationId: 'self-retained-second' }),
    });
    const secondRegular = mod.withContainerUpdateLocks(
      ['container:local:regular-after-second'],
      async () => 'second-ran',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mod.getUpdateLockSnapshot().lifecycle?.pending).toBe(1);
    mod.releaseRetainedSelfUpdateLifecycle('self-retained-second');
    await expect(secondRegular).resolves.toBe('second-ran');
  });
});

describe('withContainerUpdateLocks (global semaphore — via dynamic module import)', () => {
  // Each describe block that needs a different env uses vi.resetModules() +
  // a dynamic import so the module-level semaphore is constructed with the
  // correct process.env value.

  test('cap=1 serialises two disjoint-key callers globally', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap1');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const a = withLocks(['container:local:cap1-a'], async () => {
        order.push('a-start');
        await gate;
        order.push('a-end');
      });
      await waitForCondition(() => order.includes('a-start'), 'first capped caller to start');

      const b = withLocks(['container:local:cap1-b'], async () => {
        order.push('b');
      });
      await waitForCondition(
        () => getSnap().semaphore?.pending === 1,
        'second disjoint-key caller to wait on the global semaphore',
      );

      // B is on a disjoint key but must wait because global cap=1.
      const snap = getSnap();
      expect(snap.semaphore).toBeDefined();
      expect(snap.semaphore!.available).toBe(0);
      expect(snap.semaphore!.pending).toBe(1);

      releaseGate();
      await Promise.all([a, b]);
      expect(order).toEqual(['a-start', 'a-end', 'b']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('cap=2 allows two concurrent holders; third waits globally', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '2';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap2');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      let aStarted = false;
      let bStarted = false;
      let cStarted = false;
      const aStartedDeferred = deferred();
      const bStartedDeferred = deferred();
      const cStartedDeferred = deferred();
      const gates: Array<() => void> = [];

      const makeTask = (label: string, setStarted: (v: boolean) => void, started: Deferred) =>
        withLocks([`container:local:cap2-${label}`], async () => {
          setStarted(true);
          started.resolve();
          await new Promise<void>((resolve) => gates.push(resolve));
        });

      const a = makeTask(
        'a',
        (v) => {
          aStarted = v;
        },
        aStartedDeferred,
      );
      const b = makeTask(
        'b',
        (v) => {
          bStarted = v;
        },
        bStartedDeferred,
      );
      const c = makeTask(
        'c',
        (v) => {
          cStarted = v;
        },
        cStartedDeferred,
      );
      await Promise.all([aStartedDeferred.promise, bStartedDeferred.promise]);
      await waitForCondition(
        () => getSnap().semaphore?.pending === 1,
        'third capped caller to wait on the global semaphore',
      );

      expect(aStarted).toBe(true);
      expect(bStarted).toBe(true);
      expect(cStarted).toBe(false);

      const snap = getSnap();
      expect(snap.semaphore).toBeDefined();
      expect(snap.semaphore!.available).toBe(0);
      expect(snap.semaphore!.pending).toBe(1);

      // Release one slot — C unblocks.
      gates.shift()!();
      await cStartedDeferred.promise;
      expect(cStarted).toBe(true);

      // Clean up.
      gates.shift()!();
      gates.shift()!();
      await Promise.all([a, b, c]);

      const finalSnap = getSnap();
      expect(finalSnap.semaphore!.available).toBe(2);
      expect(finalSnap.semaphore!.pending).toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('per-container key locks still serialise within their scope under a global cap', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '5';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap5');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      // Two callers on the same container key — must serialise.
      const a = withLocks(['container:local:samekey'], async () => {
        order.push('a-start');
        await gate;
        order.push('a-end');
      });
      await waitForCondition(() => order.includes('a-start'), 'first same-key caller to start');
      const b = withLocks(['container:local:samekey'], async () => {
        order.push('b');
      });
      await waitForCondition(
        () => getSnap().pending.some((entry) => entry.key === 'container:local:samekey'),
        'second same-key caller to wait on the keyed lock',
      );

      releaseGate();
      await Promise.all([a, b]);
      expect(order).toEqual(['a-start', 'a-end', 'b']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('global semaphore released after keyed locks (inner-first release order)', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap1order');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      // Capture snapshot from inside fn (keyed lock held, semaphore held).
      let snapshotInside: ReturnType<typeof getSnap> | undefined;
      const holderStarted = deferred();

      const a = withLocks(['container:local:ordertest'], async () => {
        holderStarted.resolve();
        await gate;
        snapshotInside = getSnap();
      });
      await holderStarted.promise;
      expect(getSnap().semaphore!.available).toBe(0);

      releaseGate();
      await a;

      // After completion: everything released.
      expect(snapshotInside!.semaphore!.available).toBe(0); // still held inside fn
      expect(snapshotInside!.held).toContain('container:local:ordertest');
      const finalSnap = getSnap();
      expect(finalSnap.semaphore!.available).toBe(1);
      expect(finalSnap.held).toEqual([]);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('deadlock safety: many concurrent calls with overlapping keys + global cap', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '3';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?cap3');
      const { withContainerUpdateLocks: withLocks } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
      };

      const log: string[] = [];
      const tasks = Array.from({ length: 8 }, (_, i) => {
        // Alternate between three overlapping key sets.
        const keys =
          i % 3 === 0
            ? ['container:local:dl-x', 'container:local:dl-y']
            : i % 3 === 1
              ? ['container:local:dl-y', 'container:local:dl-z']
              : ['container:local:dl-x', 'container:local:dl-z'];
        return withLocks(keys, async () => {
          log.push(`task-${i}`);
        });
      });

      await Promise.all(tasks);
      expect(log).toHaveLength(8);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });
});

describe('withContainerUpdateLocks (bypassGlobalCap option)', () => {
  test('bypassGlobalCap=true skips the global semaphore — completes immediately while another holder occupies the cap', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?bypass1');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseRegular: () => void = () => {};
      const regularGate = new Promise<void>((resolve) => {
        releaseRegular = resolve;
      });

      // A regular update holds the cap=1 semaphore.
      const regular = withLocks(['container:local:bypass-regular'], async () => {
        order.push('regular-start');
        await regularGate;
        order.push('regular-end');
      });
      await waitForCondition(() => order.includes('regular-start'), 'regular update to start');
      expect(getSnap().semaphore!.available).toBe(0);

      // A self-update with bypassGlobalCap=true should NOT block on the semaphore.
      const self = withLocks(
        ['container:local:bypass-self'],
        async () => {
          order.push('self-update');
        },
        { bypassGlobalCap: true },
      );
      // Self-update completed without waiting for regular to finish.
      await self;
      expect(order).toContain('self-update');
      expect(order[0]).toBe('regular-start');
      expect(order[1]).toBe('self-update');

      // Semaphore still held by regular — self-update did not consume it.
      expect(getSnap().semaphore!.available).toBe(0);

      releaseRegular();
      await regular;
      expect(order).toEqual(['regular-start', 'self-update', 'regular-end']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('bypassGlobalCap=true still acquires the per-container keyed lock — two concurrent self-updates serialize', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?bypass2');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseFirst: () => void = () => {};
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const key = ['container:local:bypass-same'];

      const first = withLocks(
        key,
        async () => {
          order.push('first-start');
          await firstGate;
          order.push('first-end');
        },
        { bypassGlobalCap: true },
      );
      await waitForCondition(() => order.includes('first-start'), 'first bypass update to start');

      const second = withLocks(
        key,
        async () => {
          order.push('second');
        },
        { bypassGlobalCap: true },
      );
      await waitForCondition(
        () => getSnap().pending.some((entry) => entry.key === key[0]),
        'second bypass update to wait on the keyed lock',
      );

      // Second must wait for first to release the keyed lock.
      expect(order).toEqual(['first-start']);

      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first-start', 'first-end', 'second']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('bypassGlobalCap not set (default) — regular updates still respect the cap', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?bypass3');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const a = withLocks(['container:local:bypass-cap-a'], async () => {
        order.push('a-start');
        await gate;
        order.push('a-end');
      });
      await waitForCondition(() => order.includes('a-start'), 'first capped update to start');

      // No bypassGlobalCap — must wait.
      const b = withLocks(['container:local:bypass-cap-b'], async () => {
        order.push('b');
      });
      await waitForCondition(
        () => getSnap().semaphore?.pending === 1,
        'second capped update to wait on the global semaphore',
      );

      expect(order).toEqual(['a-start']);

      releaseGate();
      await Promise.all([a, b]);
      expect(order).toEqual(['a-start', 'a-end', 'b']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });

  test('bypassGlobalCap=false behaves identically to the default (respects cap)', async () => {
    const prev = process.env.DD_UPDATE_MAX_CONCURRENT;
    process.env.DD_UPDATE_MAX_CONCURRENT = '1';
    vi.resetModules();
    try {
      const mod = await import('./update-locks.js?bypass4');
      const { withContainerUpdateLocks: withLocks, getUpdateLockSnapshot: getSnap } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
        getUpdateLockSnapshot: typeof getUpdateLockSnapshot;
      };

      const order: string[] = [];
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const a = withLocks(['container:local:bypass-false-a'], async () => {
        order.push('a-start');
        await gate;
        order.push('a-end');
      });
      await waitForCondition(
        () => order.includes('a-start'),
        'first explicit non-bypass update to start',
      );

      const b = withLocks(
        ['container:local:bypass-false-b'],
        async () => {
          order.push('b');
        },
        { bypassGlobalCap: false },
      );
      await waitForCondition(
        () => getSnap().semaphore?.pending === 1,
        'second explicit non-bypass update to wait on the global semaphore',
      );

      expect(order).toEqual(['a-start']);

      releaseGate();
      await Promise.all([a, b]);
      expect(order).toEqual(['a-start', 'a-end', 'b']);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_MAX_CONCURRENT;
      } else {
        process.env.DD_UPDATE_MAX_CONCURRENT = prev;
      }
      vi.resetModules();
    }
  });
});
