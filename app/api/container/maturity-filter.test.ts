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
      { id: 'c1', updateAge: 60_000 } as unknown as Container,
      { id: 'c2', updateAge: 9 * 24 * 60 * 60 * 1000 } as unknown as Container,
      { id: 'c3', updateAge: 35 * 24 * 60 * 60 * 1000 } as unknown as Container,
    ];

    const filtered = applyContainerMaturityFilter(containers, 'hot');
    expect(filtered.map((container) => container.id)).toEqual(['c1']);
  });
});
