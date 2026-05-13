/**
 * Tests for token-bucket.ts.
 * RED phase: all tests will fail until token-bucket is implemented.
 */

import { acquireToken, getBucketForUrl } from './token-bucket.js';

describe('getBucketForUrl', () => {
  test.each([
    ['https://ghcr.io/v2/acme/img/tags/list', 'ghcr.io', 2, 5],
    [
      'https://pkg-containers.githubusercontent.com/v2/acme/img/tags/list',
      'pkg-containers.githubusercontent.com',
      2,
      5,
    ],
    ['https://registry-1.docker.io/v2/library/nginx/tags/list', 'registry-1.docker.io', 2, 5],
    ['https://auth.docker.io/token', 'auth.docker.io', 2, 5],
    [
      'https://production.cloudflare.docker.com/v2/library/nginx/tags/list',
      'production.cloudflare.docker.com',
      2,
      5,
    ],
    ['https://api.github.com/repos/acme/svc/releases/tags/v1', 'api.github.com', 1, 3],
    ['https://registry.example.com/v2/img/tags/list', 'registry.example.com', 5, 10],
    ['https://quay.io/v2/acme/img/tags/list', 'quay.io', 5, 10],
  ])('maps %s to host=%s ratePerSec=%d burst=%d', (url, expectedKey, expectedRate, expectedBurst) => {
    const bucket = getBucketForUrl(url);
    expect(bucket.key).toBe(expectedKey);
    expect(bucket.ratePerSec).toBe(expectedRate);
    expect(bucket.burst).toBe(expectedBurst);
  });
});

describe('getOrCreateBucket guard', () => {
  test('throws when ratePerSec is zero', async () => {
    const config = { key: `guard-zero-${Math.random()}`, ratePerSec: 0, burst: 5 };
    await expect(acquireToken(config)).rejects.toThrow('BucketConfig.ratePerSec must be > 0');
  });

  test('throws when ratePerSec is negative', async () => {
    const config = { key: `guard-neg-${Math.random()}`, ratePerSec: -1, burst: 5 };
    await expect(acquireToken(config)).rejects.toThrow('BucketConfig.ratePerSec must be > 0');
  });
});

describe('getBucketForUrl cache', () => {
  test('same URL returns the identical BucketConfig object instance', () => {
    const url = 'https://ghcr.io/v2/acme/img/tags/list';
    const first = getBucketForUrl(url);
    const second = getBucketForUrl(url);
    expect(first).toBe(second);
  });

  test('different URLs return different BucketConfig objects', () => {
    const a = getBucketForUrl('https://ghcr.io/v2/a');
    const b = getBucketForUrl('https://registry-1.docker.io/v2/b');
    expect(a).not.toBe(b);
  });
});

describe('acquireToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves immediately when bucket has tokens', async () => {
    // Use a unique host to avoid pollution between tests
    const config = { key: `test-host-${Math.random()}`, ratePerSec: 10, burst: 10 };

    let resolved = false;
    const promise = acquireToken(config).then(() => {
      resolved = true;
    });

    // Flush microtasks without advancing timers — should resolve with tokens available
    await Promise.resolve();
    await promise;

    expect(resolved).toBe(true);
  });

  test('different hosts get independent buckets', async () => {
    const hostA = { key: `host-a-${Math.random()}`, ratePerSec: 10, burst: 10 };
    const hostB = { key: `host-b-${Math.random()}`, ratePerSec: 10, burst: 10 };

    // Exhaust hostA by acquiring all burst tokens
    const acquiresA = Array.from({ length: hostA.burst }, () => acquireToken(hostA));
    // hostB should be unaffected
    const acquireB = acquireToken(hostB);

    await Promise.all([...acquiresA, acquireB]);
    // If we get here without hanging, buckets are independent
    expect(true).toBe(true);
  });

  test('waits when bucket is exhausted then resolves after refill', async () => {
    const host = { key: `test-exhausted-${Math.random()}`, ratePerSec: 2, burst: 2 };

    // Drain all tokens
    await acquireToken(host);
    await acquireToken(host);

    // Next acquire should have to wait; wrap in promise and advance time
    let resolved = false;
    const pending = acquireToken(host).then(() => {
      resolved = true;
    });

    // Before time passes, should not have resolved
    expect(resolved).toBe(false);

    // Advance enough time to refill one token (1/ratePerSec = 500ms)
    await vi.advanceTimersByTimeAsync(600);
    await pending;

    expect(resolved).toBe(true);
  });
});
