import { describe, expect, test } from 'vitest';
import type { Container } from '../../model/container.js';
import { applyContainerWatchedKindFilter, isContainerWatchedKind } from './watched-kind-filter.js';

describe('api/container/watched-kind-filter', () => {
  test('isContainerWatchedKind accepts only watched kind values', () => {
    expect(isContainerWatchedKind('watched')).toBe(true);
    expect(isContainerWatchedKind('unwatched')).toBe(true);
    expect(isContainerWatchedKind('all')).toBe(true);
    expect(isContainerWatchedKind('major')).toBe(false);
  });

  test('applyContainerWatchedKindFilter returns watched containers', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true' } },
      { id: 'c2', labels: {} },
      { id: 'c3', labels: { 'wud.watch': 'true' } },
    ] as unknown as Container[];

    const filtered = applyContainerWatchedKindFilter(containers, 'watched');
    expect(filtered.map((container) => container.id)).toEqual(['c1', 'c3']);
  });
});
