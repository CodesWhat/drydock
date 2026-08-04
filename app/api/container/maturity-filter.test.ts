import { describe, expect, test } from 'vitest';
import type { Container } from '../../model/container.js';
import { applyContainerMaturityFilter, parseContainerMaturityFilter } from './maturity-filter.js';

describe('api/container/maturity-filter', () => {
  test('parseContainerMaturityFilter normalizes valid values', () => {
    expect(parseContainerMaturityFilter('HOT')).toBe('hot');
    expect(parseContainerMaturityFilter('mature')).toBe('mature');
    expect(parseContainerMaturityFilter('established')).toBe('established');
  });

  test('applyContainerMaturityFilter returns only hot containers', () => {
    const containers = [
      { id: 'c1', updateAvailable: true, updateAge: 60_000 } as unknown as Container,
      {
        id: 'c2',
        updateAvailable: true,
        updateAge: 9 * 24 * 60 * 60 * 1000,
      } as unknown as Container,
      {
        id: 'c3',
        updateAvailable: true,
        updateAge: 35 * 24 * 60 * 60 * 1000,
      } as unknown as Container,
    ];

    const filtered = applyContainerMaturityFilter(containers, 'hot');
    expect(filtered.map((container) => container.id)).toEqual(['c1']);
  });

  test('applyContainerMaturityFilter returns the original collection when no filter is set', () => {
    const containers = [{ id: 'c1', updateAge: 60_000 } as unknown as Container];

    expect(applyContainerMaturityFilter(containers, undefined)).toBe(containers);
  });

  test('applyContainerMaturityFilter uses per-container updatePolicy.maturityMinAgeDays over the global threshold on the uncached fallback path', () => {
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
    const containers = [
      {
        id: 'c1',
        updateAvailable: true,
        updateAge: tenDaysMs,
        updatePolicy: { maturityMinAgeDays: 30 },
      } as unknown as Container,
      {
        id: 'c2',
        updateAvailable: true,
        updateAge: tenDaysMs,
      } as unknown as Container,
    ];

    // Default global threshold is 7 days: c2 has no override so it's 'mature'.
    // c1 overrides to 30 days, so the same 10-day-old update is still 'hot'.
    expect(
      applyContainerMaturityFilter(containers, 'hot').map((container) => container.id),
    ).toEqual(['c1']);
    expect(
      applyContainerMaturityFilter(containers, 'mature').map((container) => container.id),
    ).toEqual(['c2']);
  });
});
