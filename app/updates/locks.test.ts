import { LockManager, Semaphore } from './locks.js';

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

  test('ignores stale waiter decrements after the key is already clear', () => {
    const lm = new LockManager();
    const decrementWaiters = (
      lm as unknown as { decrementWaiters: (key: string) => void }
    ).decrementWaiters.bind(lm);

    decrementWaiters('k1');

    expect(lm.pending()).toEqual([]);
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

describe('Semaphore', () => {
  test('constructor rejects negative permits', () => {
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow('non-negative integer');
  });

  test('constructor rejects non-integer permits', () => {
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  test('constructor accepts 0 permits', () => {
    expect(() => new Semaphore(0)).not.toThrow();
    const s = new Semaphore(0);
    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(0);
  });

  test('acquire returns a release function immediately when permits > 0', async () => {
    const s = new Semaphore(2);
    const release = await s.acquire();
    expect(typeof release).toBe('function');
    expect(s.available()).toBe(1);
    expect(s.pending()).toBe(0);
    release();
    expect(s.available()).toBe(2);
  });

  test('available() and pending() are accurate under load', async () => {
    const s = new Semaphore(2);

    // Acquire both permits directly (synchronous path since permits > 0).
    const rel1 = await s.acquire();
    const rel2 = await s.acquire();

    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(0);

    // Queue two more waiters.
    const waiter1 = s.acquire();
    const waiter2 = s.acquire();
    await tick();

    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(2);

    // Release one slot — waiter1 gets it.
    rel1();
    await tick();
    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(1);

    // Release another — waiter2 gets it.
    rel2();
    await tick();
    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(0);

    // Let waiters release their slots.
    const rel3 = await waiter1;
    const rel4 = await waiter2;
    rel3();
    rel4();
    expect(s.available()).toBe(2);
    expect(s.pending()).toBe(0);
  });

  test('blocks when permits exhausted; resolves in FIFO order as releases happen', async () => {
    const s = new Semaphore(1);
    const order: string[] = [];
    let releaseA: (() => void) | undefined;

    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = s.acquire().then(async (rel) => {
      order.push('a-start');
      await gateA;
      order.push('a-end');
      rel();
    });

    await tick();

    const b = s.acquire().then((rel) => {
      order.push('b');
      rel();
    });

    await tick();
    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(1);

    releaseA!();
    await Promise.all([a, b]);

    expect(order).toEqual(['a-start', 'a-end', 'b']);
    expect(s.available()).toBe(1);
    expect(s.pending()).toBe(0);
  });

  test('permits=2 allows two concurrent holders; third waits', async () => {
    const s = new Semaphore(2);
    let aStarted = false;
    let bStarted = false;
    let cStarted = false;

    const gates: Array<() => void> = [];

    const makeTask = (label: string, setStarted: (v: boolean) => void) =>
      s.acquire().then(async (rel) => {
        setStarted(true);
        await new Promise<void>((resolve) => gates.push(resolve));
        rel();
      });

    const a = makeTask('a', (v) => {
      aStarted = v;
    });
    const b = makeTask('b', (v) => {
      bStarted = v;
    });
    const c = makeTask('c', (v) => {
      cStarted = v;
    });
    await tick();

    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);
    expect(cStarted).toBe(false); // waiting for a slot
    expect(s.available()).toBe(0);
    expect(s.pending()).toBe(1);

    // Release one slot — C should unblock.
    gates.shift()!();
    await tick();
    expect(cStarted).toBe(true);

    // Clean up.
    gates.shift()!();
    gates.shift()!();
    await Promise.all([a, b, c]);
    expect(s.available()).toBe(2);
  });

  test('release() is idempotent — calling it multiple times does not over-release', async () => {
    const s = new Semaphore(1);
    const release = await s.acquire();
    expect(s.available()).toBe(0);

    release();
    expect(s.available()).toBe(1);

    // Calling release a second time must not increment available beyond initial.
    release();
    expect(s.available()).toBe(1);
  });

  test('acquire with permits=0 never resolves (verified via timeout)', async () => {
    const s = new Semaphore(0);
    let resolved = false;
    s.acquire().then(() => {
      resolved = true;
    });
    await tick(8);
    expect(resolved).toBe(false);
    expect(s.pending()).toBe(1);
  });
});
