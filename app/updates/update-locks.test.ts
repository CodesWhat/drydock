import {
  buildComposeProjectLockKey,
  buildContainerLockKey,
  getUpdateLockSnapshot,
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

describe('withContainerUpdateLocks', () => {
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
});
