import {
  buildComposeProjectLockKey,
  buildContainerLockKey,
  getUpdateLockSnapshot,
  parseMaxConcurrent,
  withContainerUpdateLocks,
} from './update-locks.js';

const tick = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
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

    const keys = ['container:local:shared'];
    const a = withContainerUpdateLocks(keys, async () => {
      order.push('a-start');
      await gate;
      order.push('a-end');
    });
    await tick();

    const b = withContainerUpdateLocks(keys, async () => {
      order.push('b');
    });
    await tick();

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

    const a = withContainerUpdateLocks(['container:local:disjoint-a'], async () => {
      aStarted = true;
      await aGate;
    });
    const b = withContainerUpdateLocks(['container:local:disjoint-b'], async () => {
      bStarted = true;
      await bGate;
    });
    await tick();

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

    const a = withContainerUpdateLocks(['container:local:snapshot'], async () => {
      await gate;
    });
    await tick();

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
      await tick();

      const b = withLocks(['container:local:cap1-b'], async () => {
        order.push('b');
      });
      await tick();

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
      const gates: Array<() => void> = [];

      const makeTask = (label: string, setStarted: (v: boolean) => void) =>
        withLocks([`container:local:cap2-${label}`], async () => {
          setStarted(true);
          await new Promise<void>((resolve) => gates.push(resolve));
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
      expect(cStarted).toBe(false);

      const snap = getSnap();
      expect(snap.semaphore).toBeDefined();
      expect(snap.semaphore!.available).toBe(0);
      expect(snap.semaphore!.pending).toBe(1);

      // Release one slot — C unblocks.
      gates.shift()!();
      await tick(16);
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
      const { withContainerUpdateLocks: withLocks } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
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
      await tick();
      const b = withLocks(['container:local:samekey'], async () => {
        order.push('b');
      });
      await tick();

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

      const a = withLocks(['container:local:ordertest'], async () => {
        await gate;
        snapshotInside = getSnap();
      });
      await tick();
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
      await tick();
      expect(getSnap().semaphore!.available).toBe(0);

      // A self-update with bypassGlobalCap=true should NOT block on the semaphore.
      const self = withLocks(
        ['container:local:bypass-self'],
        async () => {
          order.push('self-update');
        },
        { bypassGlobalCap: true },
      );
      await tick();

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
      const { withContainerUpdateLocks: withLocks } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
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
      await tick();

      const second = withLocks(
        key,
        async () => {
          order.push('second');
        },
        { bypassGlobalCap: true },
      );
      await tick();

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
      const { withContainerUpdateLocks: withLocks } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
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
      await tick();

      // No bypassGlobalCap — must wait.
      const b = withLocks(['container:local:bypass-cap-b'], async () => {
        order.push('b');
      });
      await tick();

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
      const { withContainerUpdateLocks: withLocks } = mod as {
        withContainerUpdateLocks: typeof withContainerUpdateLocks;
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
      await tick();

      const b = withLocks(
        ['container:local:bypass-false-b'],
        async () => {
          order.push('b');
        },
        { bypassGlobalCap: false },
      );
      await tick();

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
