import { HassCommandRateLimiter } from './hass-command-rate-limiter.js';

function makeLimiter(overrides: { minIntervalMs?: number; maxTrackedKeys?: number } = {}): {
  limiter: HassCommandRateLimiter;
  advance: (ms: number) => void;
  set: (ms: number) => void;
} {
  let currentTime = 0;
  const limiter = new HassCommandRateLimiter({
    minIntervalMs: overrides.minIntervalMs ?? 1000,
    maxTrackedKeys: overrides.maxTrackedKeys,
    now: () => currentTime,
  });
  return {
    limiter,
    advance: (ms: number) => {
      currentTime += ms;
    },
    set: (ms: number) => {
      currentTime = ms;
    },
  };
}

test('first tryConsume for a key is accepted', () => {
  const { limiter } = makeLimiter();
  expect(limiter.tryConsume('key')).toBe(true);
});

test('immediate second tryConsume for the same key is rejected', () => {
  const { limiter } = makeLimiter();
  expect(limiter.tryConsume('key')).toBe(true);
  expect(limiter.tryConsume('key')).toBe(false);
});

test('tryConsume accepts again after minIntervalMs has elapsed', () => {
  const { limiter, set } = makeLimiter({ minIntervalMs: 1000 });
  expect(limiter.tryConsume('key')).toBe(true);
  set(1500);
  expect(limiter.tryConsume('key')).toBe(true);
});

test('boundary: elapsed exactly minIntervalMs is accepted (inclusive)', () => {
  const { limiter, set } = makeLimiter({ minIntervalMs: 1000 });
  expect(limiter.tryConsume('key')).toBe(true);
  set(1000);
  expect(limiter.tryConsume('key')).toBe(true);
});

test('boundary: elapsed minIntervalMs - 1 is rejected', () => {
  const { limiter, set } = makeLimiter({ minIntervalMs: 1000 });
  expect(limiter.tryConsume('key')).toBe(true);
  set(999);
  expect(limiter.tryConsume('key')).toBe(false);
});

test('independent keys are tracked separately', () => {
  const { limiter } = makeLimiter({ minIntervalMs: 1000 });
  expect(limiter.tryConsume('a')).toBe(true);
  expect(limiter.tryConsume('a')).toBe(false);
  // A different key has never been consumed, so it is unaffected by 'a's cooldown.
  expect(limiter.tryConsume('b')).toBe(true);
});

test('clear() resets all tracked keys', () => {
  const { limiter } = makeLimiter({ minIntervalMs: 1000 });
  expect(limiter.tryConsume('a')).toBe(true);
  expect(limiter.tryConsume('a')).toBe(false);
  limiter.clear();
  expect(limiter.tryConsume('a')).toBe(true);
});

test('maxTrackedKeys exceeded evicts the oldest tracked key (FIFO)', () => {
  const { limiter } = makeLimiter({ minIntervalMs: 1000, maxTrackedKeys: 3 });
  expect(limiter.tryConsume('a')).toBe(true);
  expect(limiter.tryConsume('b')).toBe(true);
  expect(limiter.tryConsume('c')).toBe(true);
  // Inserting a 4th key over the cap of 3 evicts the oldest ('a').
  expect(limiter.tryConsume('d')).toBe(true);

  // 'b' and 'c' are still tracked and within their cooldown window — rejected
  // as normal. (Checked before re-consuming 'a' below, since re-inserting an
  // evicted key brings the map back over the cap and triggers another
  // eviction as a side effect.)
  expect(limiter.tryConsume('b')).toBe(false);
  expect(limiter.tryConsume('c')).toBe(false);

  // 'a' was evicted, so it has no recorded acceptance time anymore — a retry at
  // the same (unchanged) clock is accepted immediately, even though its real
  // cooldown had not elapsed.
  expect(limiter.tryConsume('a')).toBe(true);
});

test('eviction loop trims via multiple iterations without relying on the first break when overBy exceeds 1', () => {
  // maxTrackedKeys is a plain constructor number with no runtime validation.
  // Under any valid non-negative cap, enforceLimit() trims the map back down
  // to the cap after every single insertion, so overBy can never exceed 1 and
  // the eviction loop always breaks on its first iteration. A pathological
  // negative cap is the only way to force overBy above 1 in a single pass,
  // exercising the loop's non-break continuation path (`removed >= overBy`
  // false) instead of relying solely on `break`.
  const { limiter } = makeLimiter({ minIntervalMs: 1000, maxTrackedKeys: -1 });
  expect(limiter.tryConsume('a')).toBe(true);
  // The pathological cap means 'a' was evicted again immediately after being
  // inserted (overBy=2 with only 1 tracked entry to remove), so a retry at the
  // same (unchanged) clock is accepted again rather than rate-limited.
  expect(limiter.tryConsume('a')).toBe(true);
});

test('uses Date.now() by default when now is not injected', () => {
  const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try {
    const limiter = new HassCommandRateLimiter({ minIntervalMs: 1000 });
    expect(limiter.tryConsume('a')).toBe(true);
    // Same mocked timestamp -> still within the cooldown window.
    expect(limiter.tryConsume('a')).toBe(false);
    dateNowSpy.mockReturnValue(1_002_000);
    expect(limiter.tryConsume('a')).toBe(true);
  } finally {
    dateNowSpy.mockRestore();
  }
});

test('default maxTrackedKeys (10,000) applies when not passed', () => {
  const currentTime = 0;
  const limiter = new HassCommandRateLimiter({ minIntervalMs: 1000, now: () => currentTime });

  for (let index = 0; index < 10_001; index += 1) {
    expect(limiter.tryConsume(`key-${index}`)).toBe(true);
  }

  // key-1 is still tracked (never evicted) and the clock never advanced, so it
  // remains within its cooldown window. (Checked before re-consuming key-0
  // below, since re-inserting an evicted key triggers another eviction.)
  expect(limiter.tryConsume('key-1')).toBe(false);
  // Exceeding the default cap of 10,000 by exactly one entry evicted key-0.
  expect(limiter.tryConsume('key-0')).toBe(true);
});
