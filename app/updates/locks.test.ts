import { LockManager } from './locks.js';

const tick = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
};

describe('LockManager.withLocks', () => {
  test('runs fn immediately when no keys are passed', async () => {
    const lm = new LockManager();
    const result = await lm.withLocks([], async () => 42);
    expect(result).toBe(42);
    expect(lm.held()).toEqual([]);
    expect(lm.pending()).toEqual([]);
  });

  test('returns the value resolved by fn', async () => {
    const lm = new LockManager();
    const result = await lm.withLocks(['k1'], async () => 'hello');
    expect(result).toBe('hello');
  });

  test('holds the lock during fn and releases after', async () => {
    const lm = new LockManager();
    let heldDuring = false;
    await lm.withLocks(['k1'], async () => {
      heldDuring = lm.isHeld('k1');
    });
    expect(heldDuring).toBe(true);
    expect(lm.isHeld('k1')).toBe(false);
    expect(lm.held()).toEqual([]);
  });

  test('releases the lock when fn throws and rethrows the error', async () => {
    const lm = new LockManager();
    const err = new Error('boom');
    await expect(
      lm.withLocks(['k1'], async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(lm.isHeld('k1')).toBe(false);
    expect(lm.held()).toEqual([]);
    expect(lm.pending()).toEqual([]);
  });

  test('serialises two callers contending on the same key in FIFO order', async () => {
    const lm = new LockManager();
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = lm.withLocks(['k1'], async () => {
      order.push('a-start');
      await aGate;
      order.push('a-end');
    });
    await tick();

    const b = lm.withLocks(['k1'], async () => {
      order.push('b-start');
      order.push('b-end');
    });
    await tick();

    expect(lm.pending()).toEqual([{ key: 'k1', waiters: 1 }]);
    expect(lm.isHeld('k1')).toBe(true);

    releaseA();
    await Promise.all([a, b]);

    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    expect(lm.pending()).toEqual([]);
    expect(lm.held()).toEqual([]);
  });

  test('lets callers on disjoint keys run concurrently', async () => {
    const lm = new LockManager();
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

    const a = lm.withLocks(['k1'], async () => {
      aStarted = true;
      await aGate;
    });
    const b = lm.withLocks(['k2'], async () => {
      bStarted = true;
      await bGate;
    });
    await tick();

    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);
    expect(lm.held().sort()).toEqual(['k1', 'k2']);

    releaseA();
    releaseB();
    await Promise.all([a, b]);
  });

  test('still runs the next waiter when the previous fn throws', async () => {
    const lm = new LockManager();
    const err = new Error('boom');
    const a = lm.withLocks(['k1'], async () => {
      throw err;
    });
    const b = lm.withLocks(['k1'], async () => 'ok');

    await expect(a).rejects.toBe(err);
    await expect(b).resolves.toBe('ok');
    expect(lm.held()).toEqual([]);
    expect(lm.pending()).toEqual([]);
  });

  test('deduplicates repeated keys', async () => {
    const lm = new LockManager();
    let snapshot: string[] = [];
    await lm.withLocks(['k1', 'k1', 'k1'], async () => {
      snapshot = lm.held();
    });
    expect(snapshot).toEqual(['k1']);
    expect(lm.held()).toEqual([]);
  });

  test('acquires multi-key locks in sorted order', async () => {
    const lm = new LockManager();
    let snapshot: string[] = [];
    await lm.withLocks(['kZ', 'kA', 'kM'], async () => {
      snapshot = lm.held();
    });
    expect(snapshot).toEqual(['kA', 'kM', 'kZ']);
    expect(lm.held()).toEqual([]);
  });

  test('avoids deadlock when callers request overlapping key sets in different orders', async () => {
    const lm = new LockManager();
    const log: string[] = [];

    const a = lm.withLocks(['x', 'y'], async () => {
      log.push('a');
    });
    const b = lm.withLocks(['y', 'x'], async () => {
      log.push('b');
    });

    await Promise.all([a, b]);
    expect(log).toHaveLength(2);
    expect(log).toEqual(['a', 'b']);
    expect(lm.held()).toEqual([]);
  });

  test('reports waiters on multiple keys via pending()', async () => {
    const lm = new LockManager();
    let release1: () => void = () => {};
    let release2: () => void = () => {};
    const gate1 = new Promise<void>((resolve) => {
      release1 = resolve;
    });
    const gate2 = new Promise<void>((resolve) => {
      release2 = resolve;
    });

    const a = lm.withLocks(['k1'], async () => {
      await gate1;
    });
    const b = lm.withLocks(['k2'], async () => {
      await gate2;
    });
    await tick();

    const c = lm.withLocks(['k1'], async () => {});
    const d = lm.withLocks(['k1'], async () => {});
    const e = lm.withLocks(['k2'], async () => {});
    await tick();

    expect(lm.pending()).toEqual([
      { key: 'k1', waiters: 2 },
      { key: 'k2', waiters: 1 },
    ]);

    release1();
    release2();
    await Promise.all([a, b, c, d, e]);
    expect(lm.pending()).toEqual([]);
    expect(lm.held()).toEqual([]);
  });

  test('held() snapshot is sorted', async () => {
    const lm = new LockManager();
    let snapshot: string[] = [];
    await lm.withLocks(['kZ', 'kA'], async () => {
      snapshot = lm.held();
    });
    expect(snapshot).toEqual(['kA', 'kZ']);
  });

  test('isHeld() reflects current state', async () => {
    const lm = new LockManager();
    expect(lm.isHeld('k1')).toBe(false);
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const a = lm.withLocks(['k1'], async () => {
      await gate;
    });
    await tick();
    expect(lm.isHeld('k1')).toBe(true);
    releaseA();
    await a;
    expect(lm.isHeld('k1')).toBe(false);
  });

  test('subsequent acquisition of a key after full release works', async () => {
    const lm = new LockManager();
    const result1 = await lm.withLocks(['k1'], async () => 'first');
    expect(result1).toBe('first');
    expect(lm.held()).toEqual([]);
    const result2 = await lm.withLocks(['k1'], async () => 'second');
    expect(result2).toBe('second');
    expect(lm.held()).toEqual([]);
  });

  test('three queued callers run in arrival order', async () => {
    const lm = new LockManager();
    const order: string[] = [];
    let releaseHead: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });

    const a = lm.withLocks(['k1'], async () => {
      order.push('a');
      await gate;
    });
    await tick();
    const b = lm.withLocks(['k1'], async () => {
      order.push('b');
    });
    const c = lm.withLocks(['k1'], async () => {
      order.push('c');
    });
    await tick();

    expect(lm.pending()).toEqual([{ key: 'k1', waiters: 2 }]);

    releaseHead();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('rejected promise from fn is propagated and lock released', async () => {
    const lm = new LockManager();
    const err = new Error('rejected');
    await expect(lm.withLocks(['k1'], () => Promise.reject(err))).rejects.toBe(err);
    expect(lm.held()).toEqual([]);
    expect(lm.pending()).toEqual([]);
  });
});
