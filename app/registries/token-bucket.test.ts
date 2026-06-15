/**
 * Tests for token-bucket.ts.
 * RED phase: all tests will fail until token-bucket is implemented.
 */

import { acquireToken, getBucketForUrl } from './token-bucket.js';

describe('getBucketForUrl', () => {
  test.each([
    ['https://ghcr.io/v2/acme/img/tags/list', 'ghcr.io', 2, 10],
    [
      'https://pkg-containers.githubusercontent.com/v2/acme/img/tags/list',
      'pkg-containers.githubusercontent.com',
      2,
      10,
    ],
    ['https://registry-1.docker.io/v2/library/nginx/tags/list', 'registry-1.docker.io', 2, 10],
    ['https://auth.docker.io/token', 'auth.docker.io', 2, 10],
    [
      'https://production.cloudflare.docker.com/v2/library/nginx/tags/list',
      'production.cloudflare.docker.com',
      2,
      10,
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

  test('falls back to raw string as hostname when URL is unparseable', () => {
    // ':::invalid:::' causes new URL() to throw — the catch block uses the raw string as key
    const bucket = getBucketForUrl(':::invalid:::');
    expect(bucket.key).toBe(':::invalid:::');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
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

  test('token count decreases by exactly 1 per acquire', async () => {
    // Kills: [AssignmentOperator] bucket.tokens += 1 mutant at line 65
    // and [ArithmeticOperator] 1 + bucket.tokens at line 70
    const config = { key: `test-decrement-${Math.random()}`, ratePerSec: 10, burst: 3 };

    // Acquire 3 tokens — should all succeed immediately (burst=3)
    await acquireToken(config);
    await acquireToken(config);
    await acquireToken(config);

    // 4th acquire should block (no tokens left)
    let resolved4 = false;
    const p4 = acquireToken(config).then(() => {
      resolved4 = true;
    });
    expect(resolved4).toBe(false);

    // Advance time to refill
    await vi.advanceTimersByTimeAsync(200);
    await p4;
    expect(resolved4).toBe(true);
  });

  test('refill: elapsed time correctly adds tokens (subtraction not addition)', async () => {
    // Kills: [ArithmeticOperator] now + bucket.lastRefillAt mutant at line 45:20
    // (correct: now - lastRefillAt)
    // We drain the bucket, then advance time. If elapsed = now + lastRefillAt (huge number),
    // tokens would overflow burst and resolve instantly even for short waits.
    // If correct (now - lastRefillAt), only the right amount accrues.
    const config = { key: `test-refill-${Math.random()}`, ratePerSec: 1, burst: 1 };

    await acquireToken(config); // drain the single token

    // Advance only 100ms — at ratePerSec=1, this adds 0.1 tokens (not enough)
    let resolved = false;
    const pending = acquireToken(config).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    // Flush microtasks
    await Promise.resolve();
    // 0.1 tokens < 1 — should not have resolved yet
    expect(resolved).toBe(false);

    // Now advance to 1100ms total — should have 1 token
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    expect(resolved).toBe(true);
  });

  test('refill: added tokens are (elapsed * ratePerSec), not (elapsed / 1000)', async () => {
    // Kills: [ArithmeticOperator] (now - lastRefillAt) * 1000 mutant at line 45:19
    // (correct: / 1000 to convert ms to seconds, then * ratePerSec)
    // At ratePerSec=2 and 500ms elapsed: correct adds 1 token (0.5s * 2 = 1)
    const config = { key: `test-rate-${Math.random()}`, ratePerSec: 2, burst: 5 };

    // Drain burst
    for (let i = 0; i < 5; i++) {
      await acquireToken(config);
    }

    let resolved = false;
    const pending = acquireToken(config).then(() => {
      resolved = true;
    });

    // 500ms at ratePerSec=2 → 1 token added (exactly enough to proceed)
    await vi.advanceTimersByTimeAsync(510);
    await pending;
    expect(resolved).toBe(true);
  });

  test('tokens capped at burst maximum (Math.min(burst, tokens+added))', async () => {
    // Kills: [MethodExpression] Math.max(burst, tokens+added) mutant at line 47:19
    // If Math.max was used instead of Math.min, tokens could exceed burst after refill.
    // With burst=2, ratePerSec=10, after waiting 1s we should have at most 2 tokens.
    const config = { key: `test-cap-${Math.random()}`, ratePerSec: 10, burst: 2 };

    // Drain all tokens
    await acquireToken(config);
    await acquireToken(config);

    // Advance 2 seconds — would add 20 tokens, but burst=2 caps it
    await vi.advanceTimersByTimeAsync(2000);

    // Acquire 2 more (up to burst) — both should succeed immediately
    await acquireToken(config);
    await acquireToken(config);

    // 3rd acquire should block again (capped at burst=2)
    let resolved3 = false;
    const p3 = acquireToken(config).then(() => {
      resolved3 = true;
    });
    // Brief flush — should NOT resolve immediately
    await Promise.resolve();
    expect(resolved3).toBe(false);

    // Advance time to refill
    await vi.advanceTimersByTimeAsync(200);
    await p3;
    expect(resolved3).toBe(true);
  });

  test('ratePerSec <= 0 guard rejects before touching bucket (ConditionalExpression)', async () => {
    // Kills: ConditionalExpression true at line 31:7
    // With ratePerSec=0, should throw rather than create an infinite-wait bucket
    const config = { key: `guard-zero2-${Math.random()}`, ratePerSec: 0, burst: 5 };
    await expect(acquireToken(config)).rejects.toThrow('BucketConfig.ratePerSec must be > 0');
  });

  test('acquireToken: bucket.tokens >= 1 check returns immediately (not < 1)', async () => {
    // Kills: BooleanLiteral false / ConditionalExpression false at line 61 and 64
    // (the while(true) + if(tokens >= 1) guard)
    const config = { key: `test-immediate-${Math.random()}`, ratePerSec: 5, burst: 5 };
    // Bucket starts full — should resolve without any timer advance
    let done = false;
    const p = acquireToken(config).then(() => {
      done = true;
    });
    await Promise.resolve();
    await p;
    expect(done).toBe(true);
  });

  test('waitMs uses (1 - tokens) not (1 + tokens): partial refill test', async () => {
    // Kills: [ArithmeticOperator] 1 + bucket.tokens mutant at line 70:32
    // If waitMs = ((1 + tokens) / rate) * 1000 instead of ((1 - tokens) / rate) * 1000,
    // the next wait period is longer than needed.
    //
    // Setup: burst=5, ratePerSec=1. Drain all 5 tokens. Wait exactly 500ms.
    //   refill: elapsed=0.5s, added=0.5 → tokens=0.5 (< 1, still blocked)
    //   Correct waitMs = (1 - 0.5) / 1 * 1000 = 500ms
    //   Mutant  waitMs = (1 + 0.5) / 1 * 1000 = 1500ms
    // Advance another 500ms:
    //   Correct: resolve (slept enough). Mutant: still blocked (needs 1500ms total).
    const config = { key: `test-partial-${Math.random()}`, ratePerSec: 1, burst: 5 };

    // Drain all 5 burst tokens
    for (let i = 0; i < 5; i++) {
      await acquireToken(config);
    }

    // Advance 500ms — refill gives 0.5 tokens (not enough to acquire)
    await vi.advanceTimersByTimeAsync(500);

    let resolved = false;
    const pending = acquireToken(config).then(() => {
      resolved = true;
    });

    // With correct code: waitMs = 500ms. Advance 500ms → should resolve.
    // With mutant: waitMs = 1500ms. Still blocked after 500ms.
    await vi.advanceTimersByTimeAsync(510);
    await pending;
    expect(resolved).toBe(true);
  });
});

// ── getBucketForUrl regex anchoring tests ─────────────────────────────────────

describe('getBucketForUrl regex anchoring', () => {
  test('ghcr.io with trailing subdomain does NOT match ghcr.io pattern ($ anchor)', async () => {
    // Kills: /^(ghcr\.io|...)/ without $ — "ghcr.io.extra.com" would match without $
    // With correct /^..$/, ghcr.io.extra.com does not match exactly.
    const bucket = getBucketForUrl('https://ghcr.io.extra.com/v2/img/tags/list');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('pkg-containers.githubusercontent.com with extra subdomain does NOT match ($ anchor)', async () => {
    // Kills: /^(ghcr\.io|pkg-containers\.githubusercontent\.com)/ without $
    const bucket = getBucketForUrl('https://pkg-containers.githubusercontent.com.evil/v2/img');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('prefix "xghcr.io" does NOT match ghcr.io pattern (^ anchor)', async () => {
    // Kills: /(ghcr\.io|...)$/ without ^ — doesn't start with ghcr.io
    const bucket = getBucketForUrl('https://xghcr.io/v2/img/tags/list');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('registry-1.docker.io with trailing suffix does NOT match docker pattern ($ anchor)', async () => {
    // Kills: /^(registry-1\.docker\.io|...)/ without $ — "registry-1.docker.io.evil" would match
    const bucket = getBucketForUrl('https://registry-1.docker.io.evil/v2/img');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('auth.docker.io with trailing suffix does NOT match docker pattern ($ anchor)', async () => {
    // Kills: /^(registry-1\.docker\.io|auth\.docker\.io|...)/ without $
    const bucket = getBucketForUrl('https://auth.docker.io.extra/token');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('prefix "xregistry-1.docker.io" does NOT match docker pattern (^ anchor)', async () => {
    // Kills: /(registry-1\.docker\.io|...)$/ without ^
    const bucket = getBucketForUrl('https://xregistry-1.docker.io/v2/img');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('api.github.com with trailing suffix does NOT match api.github.com ($ anchor)', async () => {
    // Kills: /^api\.github\.com/ without $ — "api.github.com.evil" would match without $
    const bucket = getBucketForUrl('https://api.github.com.evil/repos');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });

  test('prefix "xapi.github.com" does NOT match api.github.com (^ anchor)', async () => {
    // Kills: /api\.github\.com$/ without ^ — xapi.github.com ends with api.github.com
    const bucket = getBucketForUrl('https://xapi.github.com/repos');
    expect(bucket.ratePerSec).toBe(5);
    expect(bucket.burst).toBe(10);
  });
});
