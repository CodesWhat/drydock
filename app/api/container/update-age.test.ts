import { describe, expect, test, vi } from 'vitest';
import type { Container } from '../../model/container.js';
import { getContainerUpdateAge } from './update-age.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('api/container/update-age', () => {
  test('returns undefined when updateAvailable is falsy (unset)', () => {
    const container = { id: 'c1' } as unknown as Container;
    expect(getContainerUpdateAge(container)).toBeUndefined();
  });

  test('returns undefined when updateAvailable is explicitly false, even with a stale finite updateAge', () => {
    // Mirrors buildFallbackContainerReport: spreads a validated container (which
    // freezes the live `updateAge` getter into a plain number) then flips
    // updateAvailable to false. The stale age must not leak through.
    const container = {
      id: 'c1',
      updateAvailable: false,
      updateAge: 5 * DAY_MS,
    } as unknown as Container;
    expect(getContainerUpdateAge(container)).toBeUndefined();
  });

  test('returns the cached container.updateAge when it is a finite number', () => {
    const container = {
      id: 'c1',
      updateAvailable: true,
      updateAge: 3 * DAY_MS,
    } as unknown as Container;
    expect(getContainerUpdateAge(container)).toBe(3 * DAY_MS);
  });

  test('falls back to the trust-aware clock when updateAge is absent (not processed through validate())', () => {
    const now = Date.now();
    const updateDetectedAt = new Date(now - 4 * DAY_MS).toISOString();
    const container = {
      id: 'c1',
      updateAvailable: true,
      updateDetectedAt,
    } as unknown as Container;
    expect(getContainerUpdateAge(container)).toBeGreaterThanOrEqual(4 * DAY_MS - 5_000);
  });

  test('fallback ignores an untrusted publishedAt in favor of updateDetectedAt (#556 regression)', () => {
    const now = Date.now();
    const updateDetectedAt = new Date(now - 2 * DAY_MS).toISOString();
    // Older than updateDetectedAt but not trusted — must not shrink the age via a
    // Math.min-style blend the way the old three-way fallback used to.
    const publishedAt = new Date(now - 45 * DAY_MS).toISOString();
    const container = {
      id: 'c1',
      updateAvailable: true,
      updateDetectedAt,
      result: { publishedAt },
    } as unknown as Container;

    const age = getContainerUpdateAge(container);
    expect(age).toBeGreaterThanOrEqual(2 * DAY_MS - 5_000);
    expect(age).toBeLessThan(45 * DAY_MS);
  });

  test('fallback uses a trusted publishedAt when earlier than updateDetectedAt', () => {
    const now = Date.now();
    const updateDetectedAt = new Date(now - 2 * DAY_MS).toISOString();
    const publishedAt = new Date(now - 10 * DAY_MS).toISOString();
    const container = {
      id: 'c1',
      updateAvailable: true,
      updateDetectedAt,
      result: { publishedAt, publishedAtTrusted: true },
    } as unknown as Container;

    expect(getContainerUpdateAge(container)).toBeGreaterThanOrEqual(10 * DAY_MS - 5_000);
  });

  test('fallback falls back to firstSeenAt when updateDetectedAt is absent', () => {
    const now = Date.now();
    const firstSeenAt = new Date(now - 6 * DAY_MS).toISOString();
    const container = {
      id: 'c1',
      updateAvailable: true,
      firstSeenAt,
    } as unknown as Container;

    expect(getContainerUpdateAge(container)).toBeGreaterThanOrEqual(6 * DAY_MS - 5_000);
  });

  test('returns undefined when updateAvailable is true but no clock source resolves', () => {
    const container = { id: 'c1', updateAvailable: true } as unknown as Container;
    expect(getContainerUpdateAge(container)).toBeUndefined();
  });

  test('clamps to 0 rather than a negative age when now is before the resolved clock start', () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-03-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const updateDetectedAt = new Date(now.getTime() + DAY_MS).toISOString();
      const container = {
        id: 'c1',
        updateAvailable: true,
        updateDetectedAt,
      } as unknown as Container;
      expect(getContainerUpdateAge(container)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
